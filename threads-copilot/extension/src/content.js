/*
 * Content script — the eyes. Watches the feed you're scrolling, extracts the
 * posts already on screen, asks the local scoring service which ones are worth
 * replying to, and drops a small badge on the on-topic ones.
 *
 * Strictly read-and-display: it never likes, replies, follows, or fires any
 * request to Threads. Reply is a plain link you click yourself.
 */
(function () {
  const DEFAULTS = { enabled: true, serviceUrl: 'http://127.0.0.1:8770' };
  let settings = Object.assign({}, DEFAULTS);

  const processed = new WeakSet();   // units already badged
  const seen = new Set();            // shortcodes already scored (dedupe across virtualization)
  const unitByShort = new Map();     // shortcode -> current unit element

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

  function badgeEl(score, permalink) {
    const bar = document.createElement('div');
    bar.className = 'tc-bar tc-' + score.verdict;

    const tag = document.createElement('span');
    tag.className = 'tc-tag';
    tag.textContent = (score.verdict === 'reply' ? '💬 可回覆' : '👀 觀察') + ' · ' + score.reason;
    bar.appendChild(tag);

    const heat = document.createElement('span');
    heat.className = 'tc-heat';
    heat.textContent = '🔥 ' + (score.heat || 0);
    bar.appendChild(heat);

    if (permalink) {
      const open = document.createElement('a');
      open.className = 'tc-btn';
      open.textContent = '↗ 開啟';
      open.href = permalink;
      open.target = '_blank';
      open.rel = 'noopener';
      bar.appendChild(open);
    }

    const up = document.createElement('button');
    up.className = 'tc-btn';
    up.textContent = '👍';
    up.title = '這種作者多推';
    const down = document.createElement('button');
    down.className = 'tc-btn';
    down.textContent = '👎';
    down.title = '這種作者別再顯示';
    up.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); sendFeedback(score.author, 'up'); bar.classList.add('tc-ack'); });
    down.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); sendFeedback(score.author, 'down'); bar.style.display = 'none'; });
    bar.appendChild(up);
    bar.appendChild(down);

    return bar;
  }

  function renderBadge(unit, score) {
    if (!score || score.verdict === 'skip') return;
    if (unit.querySelector(':scope > .tc-bar')) return;
    unit.classList.add('tc-hit', 'tc-hit-' + score.verdict);
    unit.insertBefore(badgeEl(score, score.permalink), unit.firstChild);
  }

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
      if (seen.has(post.shortcode)) continue; // already scored on an earlier render
      seen.add(post.shortcode);
      batch.push(post);
    }
    if (!batch.length) return;
    const scores = await scoreBatch(batch);
    for (const s of scores) {
      const unit = unitByShort.get(TCExtract.shortcodeOf(s.permalink));
      if (unit) renderBadge(unit, s);
    }
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; collect().catch(() => {}); }, 350);
  }

  async function main() {
    await loadSettings();
    if (!settings.enabled) return;
    collect().catch(() => {});
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    // Reflect enable/disable toggles without a manual reload.
    try {
      chrome.storage.onChanged.addListener((ch) => {
        if (ch.enabled) { settings.enabled = ch.enabled.newValue; if (settings.enabled) schedule(); }
        if (ch.serviceUrl) settings.serviceUrl = ch.serviceUrl.newValue;
      });
    } catch { /* ignore */ }
  }

  main();
})();
