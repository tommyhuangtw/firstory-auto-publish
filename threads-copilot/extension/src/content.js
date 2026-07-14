/*
 * Content script — the eyes. Watches the feed you're scrolling, extracts the
 * posts already on screen, asks the local scoring service which ones are worth
 * replying to, and (a) marks them inline + (b) collects them into a right-side
 * panel you can click to jump straight to the post.
 *
 * Strictly read-and-display: it never likes, replies, follows, or fires any
 * request to Threads. Opening a post is a plain link you click yourself.
 */
(function () {
  const DEFAULTS = { enabled: true, serviceUrl: 'http://127.0.0.1:8770' };
  let settings = Object.assign({}, DEFAULTS);

  const processed = new WeakSet();   // units already handled
  const seen = new Set();            // shortcodes already scored (dedupe across virtualization)
  const unitByShort = new Map();     // shortcode -> current unit element
  const candidates = new Map();      // shortcode -> { score, post } for the side panel

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(DEFAULTS, (v) => { settings = Object.assign({}, DEFAULTS, v || {}); resolve(); });
      } catch { resolve(); }
    });
  }

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
      candidates.delete(TCExtract.shortcodeOf(score.permalink)); renderPanel();
    });
    bar.appendChild(up); bar.appendChild(down);
    unit.insertBefore(bar, unit.firstChild);
  }

  /* ---------------- right-side panel (accumulating list) ---------------- */

  let panel, listEl, countEl, collapsed = false;

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'tc-panel tc-hidden';
    panel.innerHTML =
      '<div class="tc-panel-head">' +
        '<span class="tc-panel-title">🎯 可回覆 <span class="tc-count">0</span></span>' +
        '<button class="tc-toggle" title="收合/展開">—</button>' +
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
  }

  function renderPanel() {
    if (!panel) buildPanel();
    const items = Array.from(candidates.values()).sort((a, b) => (b.score.heat || 0) - (a.score.heat || 0));
    countEl.textContent = String(items.length);
    panel.classList.toggle('tc-hidden', items.length === 0);

    listEl.innerHTML = '';
    for (const { score, post } of items) {
      const row = document.createElement('a');
      row.className = 'tc-item';
      row.href = post.permalink || '#';
      row.target = '_blank';
      row.rel = 'noopener';
      row.innerHTML =
        '<div class="tc-item-top">' +
          '<span class="tc-item-author">@' + (post.author || '?') + '</span>' +
          '<span class="tc-item-meta">' + score.reason + ' · 👥' + (score.eng || 0) + ' · 🔥' + (score.heat || 0) + '</span>' +
        '</div>' +
        '<div class="tc-item-text"></div>';
      row.querySelector('.tc-item-text').textContent = (post.text || '').slice(0, 90);
      row.addEventListener('click', () => { row.classList.add('tc-visited'); });
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
    for (const s of scores) {
      if (s.verdict !== 'reply') continue;
      const sc = TCExtract.shortcodeOf(s.permalink);
      const unit = unitByShort.get(sc);
      if (unit) renderBadge(unit, s);
      const post = byShort.get(sc);
      if (post) candidates.set(sc, { score: s, post });
    }
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
    buildPanel();
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
