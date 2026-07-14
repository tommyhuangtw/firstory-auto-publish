/*
 * Content script — the eyes. Watches the feed you're scrolling, extracts the
 * posts already on screen, asks the local scoring service which ones are worth
 * replying to, and (a) marks them inline + (b) collects them into a right-side
 * panel you can click to jump straight to the post.
 *
 * The panel PERSISTS across page loads / browser restarts (chrome.storage.local),
 * so when you open Threads the reply candidates you found earlier are already
 * there — no need to re-scroll. Entries older than MAX_AGE auto-expire. The panel
 * has filters (category / min interactions / time) over the collected list.
 *
 * Strictly read-and-display: it never likes, replies, follows, or fires any
 * request to Threads. Opening a post is a plain link you click yourself.
 */
(function () {
  const DEFAULTS = { enabled: true, serviceUrl: 'http://127.0.0.1:8770' };
  let settings = Object.assign({}, DEFAULTS);

  const STORE_KEY = 'tc_candidates';
  const FILTER_KEY = 'tc_filters';
  const SIZE_KEY = 'tc_size';
  const MAX_AGE_MS = 24 * 3600 * 1000;   // drop candidates older than 24h (reply value decays)
  const MAX_ITEMS = 60;                   // cap stored + displayed

  let panelSize = null;                   // { w, h } — user-dragged panel size, persisted

  const processed = new WeakSet();   // units already handled
  const seen = new Set();            // shortcodes already scored (dedupe across virtualization + reloads)
  const unitByShort = new Map();     // shortcode -> current unit element
  const candidates = new Map();      // shortcode -> { score, post, collectedAt, visited }

  let filters = { category: 'all', minEng: 0, maxAgeH: 0 }; // 0 = 不限

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(DEFAULTS, (v) => { settings = Object.assign({}, DEFAULTS, v || {}); resolve(); });
      } catch { resolve(); }
    });
  }

  // Pull previously-found candidates + saved filter choices from storage.
  function loadStored() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [STORE_KEY]: [], [FILTER_KEY]: null, [SIZE_KEY]: null }, (v) => {
          const now = Date.now();
          for (const c of v[STORE_KEY] || []) {
            if (!c.post || now - (c.collectedAt || 0) >= MAX_AGE_MS) continue;
            const sc = TCExtract.shortcodeOf(c.post.permalink);
            if (!sc) continue;
            candidates.set(sc, c);
            seen.add(sc); // don't re-score what we already have
          }
          if (v[FILTER_KEY]) filters = Object.assign(filters, v[FILTER_KEY]);
          if (v[SIZE_KEY]) panelSize = v[SIZE_KEY];
          resolve();
        });
      } catch { resolve(); }
    });
  }

  let persistTimer = null;
  function persist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const now = Date.now();
      const arr = Array.from(candidates.values())
        .filter((c) => now - (c.collectedAt || 0) < MAX_AGE_MS)
        .sort((a, b) => (b.collectedAt || 0) - (a.collectedAt || 0))
        .slice(0, MAX_ITEMS);
      try { chrome.storage.local.set({ [STORE_KEY]: arr }); } catch { /* ignore */ }
    }, 500);
  }

  function saveFilters() { try { chrome.storage.local.set({ [FILTER_KEY]: filters }); } catch { /* ignore */ } }

  function scoreBatch(posts) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'score', posts, serviceUrl: settings.serviceUrl },
          (r) => resolve((r && r.scores) || []),
        );
      } catch { resolve([]); }
    });
  }

  function sendFeedback(author, signal) {
    try {
      chrome.runtime.sendMessage({ type: 'feedback', author, signal, serviceUrl: settings.serviceUrl }, () => {});
    } catch { /* ignore */ }
  }

  /* ---------------- inline badge (on the post itself) ---------------- */

  function renderBadge(unit, score) {
    if (!score || score.verdict !== 'reply') return;
    if (unit.querySelector(':scope > .tc-bar')) return;
    unit.classList.add('tc-hit');

    const bar = document.createElement('div');
    bar.className = 'tc-bar';
    bar.innerHTML =
      '<span class="tc-tag">💬 值得回覆</span>' +
      '<span class="tc-chip">' + score.reason + '</span>' +
      '<span class="tc-chip">👥 ' + (score.eng || 0) + '</span>' +
      '<span class="tc-chip">🔥 ' + (score.heat || 0) + '</span>';

    const up = document.createElement('button');
    up.className = 'tc-btn'; up.textContent = '👍'; up.title = '這種作者多推';
    const down = document.createElement('button');
    down.className = 'tc-btn'; down.textContent = '👎'; down.title = '這種作者別再顯示';
    up.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); sendFeedback(score.author, 'up'); });
    down.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      sendFeedback(score.author, 'down');
      bar.remove(); unit.classList.remove('tc-hit');
      candidates.delete(TCExtract.shortcodeOf(score.permalink)); persist(); renderPanel();
    });
    bar.appendChild(up); bar.appendChild(down);
    unit.insertBefore(bar, unit.firstChild);
  }

  /* ---------------- right-side panel (persistent + filterable) ---------------- */

  let panel, listEl, countEl, collapsed = false;
  const CATEGORIES = ['AI', '接案', '職涯', '留學', '海外生活', '自訂'];

  function ageLabel(collectedAt) {
    const h = Math.floor((Date.now() - (collectedAt || 0)) / 3600000);
    return h <= 0 ? '剛剛' : h + 'h前';
  }

  function opt(value, label, selected) {
    return '<option value="' + value + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + label + '</option>';
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'tc-panel tc-hidden';
    panel.innerHTML =
      '<div class="tc-panel-head">' +
        '<span class="tc-panel-title">🎯 可回覆 <span class="tc-count">0</span></span>' +
        '<span class="tc-panel-actions">' +
          '<button class="tc-clear" title="清空清單">🗑</button>' +
          '<button class="tc-toggle" title="收合/展開">—</button>' +
        '</span>' +
      '</div>' +
      '<div class="tc-filters">' +
        '<select class="tc-f-cat">' + [opt('all', '全部類別', filters.category)].concat(CATEGORIES.map((c) => opt(c, c, filters.category))).join('') + '</select>' +
        '<select class="tc-f-eng">' + [['0', '互動不限'], ['50', '≥50'], ['100', '≥100'], ['200', '≥200'], ['500', '≥500']].map(([v, l]) => opt(v, l, filters.minEng)).join('') + '</select>' +
        '<select class="tc-f-age">' + [['0', '時間不限'], ['6', '6h 內'], ['12', '12h 內'], ['24', '24h 內']].map(([v, l]) => opt(v, l, filters.maxAgeH)).join('') + '</select>' +
      '</div>' +
      '<div class="tc-list"></div>';
    document.body.appendChild(panel);
    listEl = panel.querySelector('.tc-list');
    countEl = panel.querySelector('.tc-count');

    panel.querySelector('.tc-toggle').addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('tc-collapsed', collapsed);
      panel.querySelector('.tc-toggle').textContent = collapsed ? '＋' : '—';
    });
    panel.querySelector('.tc-clear').addEventListener('click', () => { candidates.clear(); persist(); renderPanel(); });
    panel.querySelector('.tc-f-cat').addEventListener('change', (e) => { filters.category = e.target.value; saveFilters(); renderPanel(); });
    panel.querySelector('.tc-f-eng').addEventListener('change', (e) => { filters.minEng = parseInt(e.target.value, 10) || 0; saveFilters(); renderPanel(); });
    panel.querySelector('.tc-f-age').addEventListener('change', (e) => { filters.maxAgeH = parseInt(e.target.value, 10) || 0; saveFilters(); renderPanel(); });

    // Apply saved size, then wire a drag-to-resize handle (bottom-left corner).
    if (panelSize && panelSize.w) { panel.style.width = panelSize.w + 'px'; panel.style.height = panelSize.h + 'px'; }
    const handle = document.createElement('div');
    handle.className = 'tc-resize';
    handle.title = '拖曳調整大小';
    panel.appendChild(handle);
    let rz = null;
    const onMove = (e) => {
      if (!rz) return;
      const w = Math.min(Math.max(rz.w + (rz.x - e.clientX), 260), window.innerWidth * 0.9);
      const h = Math.min(Math.max(rz.h + (e.clientY - rz.y), 200), window.innerHeight * 0.92);
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (rz) { panelSize = { w: panel.offsetWidth, h: panel.offsetHeight }; try { chrome.storage.local.set({ [SIZE_KEY]: panelSize }); } catch { /* ignore */ } rz = null; }
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      rz = { x: e.clientX, y: e.clientY, w: panel.offsetWidth, h: panel.offsetHeight };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function passFilter(entry) {
    if (filters.category !== 'all' && entry.score.reason !== filters.category) return false;
    if (filters.minEng && (entry.score.eng || 0) < filters.minEng) return false;
    if (filters.maxAgeH && (Date.now() - (entry.collectedAt || 0)) > filters.maxAgeH * 3600000) return false;
    return true;
  }

  function renderPanel() {
    if (!panel) buildPanel();
    const all = Array.from(candidates.values());
    panel.classList.toggle('tc-hidden', all.length === 0);

    const items = all.filter(passFilter)
      .sort((a, b) => (b.score.heat || 0) - (a.score.heat || 0))
      .slice(0, MAX_ITEMS);
    countEl.textContent = String(items.length);

    listEl.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tc-empty';
      empty.textContent = all.length ? '無符合篩選條件的貼文' : '往下滑,符合的貼文會出現在這';
      listEl.appendChild(empty);
      return;
    }
    for (const entry of items) {
      const { score, post } = entry;
      const row = document.createElement('a');
      row.className = 'tc-item' + (entry.visited ? ' tc-visited' : '');
      row.href = post.permalink || '#';
      row.target = '_blank';
      row.rel = 'noopener';
      row.innerHTML =
        '<div class="tc-item-top">' +
          '<span class="tc-item-author">@' + (post.author || '?') + '</span>' +
          '<span class="tc-item-meta">' + score.reason + ' · 👥' + (score.eng || 0) + ' · 🔥' + (score.heat || 0) + ' · ' + ageLabel(entry.collectedAt) + '</span>' +
        '</div>' +
        '<div class="tc-item-text"></div>';
      const full = post.text || '';
      const textEl = row.querySelector('.tc-item-text');
      textEl.textContent = full.slice(0, 500);   // full text lives in the DOM; clamped by CSS, expands on hover
      row.title = full;                           // native tooltip fallback
      row.addEventListener('click', () => { entry.visited = true; row.classList.add('tc-visited'); persist(); });

      const rm = document.createElement('button');
      rm.className = 'tc-item-remove';
      rm.textContent = '×';
      rm.title = '從清單移除';
      rm.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        candidates.delete(TCExtract.shortcodeOf(post.permalink));
        persist(); renderPanel();
      });
      row.appendChild(rm);
      listEl.appendChild(row);
    }
  }

  /* ---------------- scan loop ---------------- */

  async function collect() {
    if (!settings.enabled) return;
    const units = TCExtract.findUnits(document);
    const batch = [];
    for (const unit of units) {
      if (processed.has(unit)) continue;
      const post = TCExtract.extractPost(unit);
      if (!post || !post.shortcode) continue; // not hydrated yet — retry next pass
      processed.add(unit);
      unitByShort.set(post.shortcode, unit);
      if (seen.has(post.shortcode)) continue;
      seen.add(post.shortcode);
      batch.push(post);
    }
    if (!batch.length) return;
    const scores = await scoreBatch(batch);
    const byShort = new Map(batch.map((p) => [p.shortcode, p]));
    let added = false;
    for (const s of scores) {
      if (s.verdict !== 'reply') continue;
      const sc = TCExtract.shortcodeOf(s.permalink);
      const unit = unitByShort.get(sc);
      if (unit) renderBadge(unit, s);
      const post = byShort.get(sc);
      if (post) { candidates.set(sc, { score: s, post, collectedAt: Date.now(), visited: false }); added = true; }
    }
    if (added) persist();
    renderPanel();
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; collect().catch(() => {}); }, 350);
  }

  async function main() {
    await loadSettings();
    if (!settings.enabled) return;
    await loadStored();
    buildPanel();
    renderPanel();            // show persisted candidates immediately, before any scroll
    collect().catch(() => {});
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    try {
      chrome.storage.onChanged.addListener((ch) => {
        if (ch.enabled) { settings.enabled = ch.enabled.newValue; if (settings.enabled) schedule(); }
        if (ch.serviceUrl) settings.serviceUrl = ch.serviceUrl.newValue;
      });
    } catch { /* ignore */ }
  }

  main();
})();
