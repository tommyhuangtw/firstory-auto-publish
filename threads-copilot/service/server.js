'use strict';
/*
 * Threads 海巡 Copilot — light standalone scoring service.
 *
 * Runs on its own (e.g. on the M4 Mac), independent of the podcast dashboard.
 * The browser extension POSTs the posts it sees to /score and gets back a
 * reply/watch/skip verdict per post, using the preference profile stored here.
 *
 *   npm start            # http://127.0.0.1:8770
 *   THREADS_COPILOT_PORT=9000 npm start
 *
 * Endpoints:
 *   GET  /health       -> { ok: true }
 *   GET  /preference   -> current preference profile
 *   POST /preference   -> merge body into preference, persist, return it
 *   POST /score        -> { posts:[...] }  =>  { scores:[...] }
 *   POST /feedback     -> { author, signal:'up'|'down' }  (👍 boost / 👎 mute author)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { scorePosts } = require('./scorer');

const PORT = Number(process.env.THREADS_COPILOT_PORT) || 8770;
const PREF_FILE = path.join(__dirname, 'preference.json');
const DEFAULT_FILE = path.join(__dirname, 'preference.default.json');

function loadPref() {
  for (const f of [PREF_FILE, DEFAULT_FILE]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* try next */ }
  }
  return {};
}
function savePref(p) { fs.writeFileSync(PREF_FILE, JSON.stringify(p, null, 2)); }

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 2_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && url === '/preference') return send(res, 200, loadPref());
    if (req.method === 'POST' && url === '/preference') {
      const body = await readBody(req);
      const pref = Object.assign(loadPref(), body);
      savePref(pref);
      return send(res, 200, pref);
    }
    if (req.method === 'POST' && url === '/score') {
      const body = await readBody(req);
      const posts = Array.isArray(body.posts) ? body.posts : [];
      const scores = scorePosts(posts, loadPref(), Date.now());
      return send(res, 200, { scores });
    }
    if (req.method === 'POST' && url === '/feedback') {
      const { author, signal } = await readBody(req);
      const pref = loadPref();
      pref.mutedAuthors = pref.mutedAuthors || [];
      pref.likedAuthors = pref.likedAuthors || [];
      if (author) {
        if (signal === 'down' && !pref.mutedAuthors.includes(author)) pref.mutedAuthors.push(author);
        if (signal === 'up' && !pref.likedAuthors.includes(author)) pref.likedAuthors.push(author);
      }
      savePref(pref);
      return send(res, 200, { ok: true, pref });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`threads-copilot scorer listening on http://127.0.0.1:${PORT}`);
});
