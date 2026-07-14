/*
 * DOM extraction — reads posts that are ALREADY rendered on the page the user is
 * viewing. No extra network requests, no automation of clicks/scroll. Selectors are
 * semantic/structural (lang, time[datetime], svg[aria-label], /@handle, /post/ hrefs)
 * — NOT Threads' hashed `x-` CSS classes, which churn constantly.
 *
 * Ported from dashboard/src/services/trends/crawler.ts:extractPostsOnPage, but
 * per-unit so the content script can score posts as they scroll into view.
 */
(function (root) {
  function parseCount(raw) {
    if (!raw) return 0;
    const s = String(raw).replace(/[,\s]/g, '').trim();
    const m = s.match(/([\d.]+)\s*([KkMm萬万])?/);
    if (!m) return 0;
    let n = parseFloat(m[1]) || 0;
    const u = m[2];
    if (u === 'K' || u === 'k') n *= 1e3;
    else if (u === 'M' || u === 'm') n *= 1e6;
    else if (u === '萬' || u === '万') n *= 1e4;
    return Math.round(n);
  }

  function shortcodeOf(href) {
    const m = String(href || '').match(/\/post\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : '';
  }

  function findUnits(rootEl) {
    const scope = rootEl || document;
    let units = Array.from(scope.querySelectorAll('div[data-pagelet^="threads_feed_"]'));
    if (units.length === 0) units = Array.from(scope.querySelectorAll('div[data-pressable-container="true"]'));
    return units;
  }

  // Engagement buttons carry an svg aria-label; support both ZH and EN Threads UIs.
  const LIKE_SEL = 'svg[aria-label="讚"],svg[aria-label="Like"],svg[aria-label="按讚"]';
  const REPLY_SEL = 'svg[aria-label="回覆"],svg[aria-label="Reply"]';

  function extractPost(unit) {
    const langEl = unit.querySelector('div[lang]');
    const text = ((langEl && langEl.textContent) || '').trim().slice(0, 800);
    if (text.length < 8) return null;

    const timeEl = unit.querySelector('time[datetime]');
    const timeLabel = timeEl ? timeEl.getAttribute('datetime') || '' : '';
    const timeAnchor = timeEl ? timeEl.closest('a') : null;
    const fallbackA = unit.querySelector('a[href*="/post/"]');
    const permalink = (timeAnchor && timeAnchor.href) || (fallbackA && fallbackA.href) || '';

    const authorA = unit.querySelector('a[href^="/@"]');
    const author = ((authorA && authorA.getAttribute('href')) || '').replace('/@', '').split('/')[0];

    // Take the LAST engagement bar so an outer post wins over any embedded quote-post.
    const likeSvgs = unit.querySelectorAll(LIKE_SEL);
    const replySvgs = unit.querySelectorAll(REPLY_SEL);
    const likeBtn = likeSvgs.length ? likeSvgs[likeSvgs.length - 1].closest('[role="button"]') : null;
    const replyBtn = replySvgs.length ? replySvgs[replySvgs.length - 1].closest('[role="button"]') : null;

    return {
      text,
      likeCount: parseCount(likeBtn && likeBtn.textContent),
      replyCount: parseCount(replyBtn && replyBtn.textContent),
      timestamp: /\d{4}-\d{2}-\d{2}/.test(timeLabel) ? timeLabel : undefined,
      permalink: permalink || undefined,
      author: author || undefined,
      shortcode: shortcodeOf(permalink),
    };
  }

  root.TCExtract = { parseCount, shortcodeOf, findUnits, extractPost };
})(typeof window !== 'undefined' ? window : globalThis);
