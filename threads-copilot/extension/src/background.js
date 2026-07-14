/*
 * Service worker — the only place that talks to the local scoring service.
 * Doing the fetch here (not in the content script) sidesteps threads.com's page
 * CSP / connect-src and Local-Network-Access gating on loopback.
 */
const FALLBACK = 'http://127.0.0.1:8770';

function post(base, path, body) {
  return fetch((base || FALLBACK) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'score') {
    post(msg.serviceUrl, '/score', { posts: msg.posts })
      .then((d) => sendResponse({ scores: (d && d.scores) || [] }))
      .catch((e) => sendResponse({ scores: [], error: String(e) }));
    return true; // keep the message channel open for the async response
  }
  if (msg.type === 'feedback') {
    post(msg.serviceUrl, '/feedback', { author: msg.author, signal: msg.signal })
      .then((d) => sendResponse(d))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
});
