'use strict';
// The extension's extract.js is a browser file (references `window`). Load it with a
// window stub and test its pure helpers (parseCount / shortcodeOf) — the count-parsing
// is the risky bit; extractPost's DOM walk is verified manually in a real browser.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../../extension/src/extract.js'), 'utf8');
const win = {};
new Function('window', code)(win);
const { parseCount, shortcodeOf } = win.TCExtract;

let n = 0;
const t = (fn) => { fn(); n++; };

t(() => assert.strictEqual(parseCount('1,234'), 1234));
t(() => assert.strictEqual(parseCount('1.2K'), 1200));
t(() => assert.strictEqual(parseCount('12.3萬'), 123000));
t(() => assert.strictEqual(parseCount('3M'), 3000000));
t(() => assert.strictEqual(parseCount(''), 0));
t(() => assert.strictEqual(parseCount(null), 0));
t(() => assert.strictEqual(parseCount('讚'), 0));
t(() => assert.strictEqual(shortcodeOf('https://www.threads.com/@ai.lanrenbao/post/AbC123_-x'), 'AbC123_-x'));
t(() => assert.strictEqual(shortcodeOf('https://www.threads.com/@ai.lanrenbao'), ''));

console.log(`extract.test.js: ${n} tests passed`);
