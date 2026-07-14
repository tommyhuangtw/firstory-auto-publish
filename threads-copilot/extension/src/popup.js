const DEFAULTS = { enabled: true, serviceUrl: 'http://127.0.0.1:8770' };
const $ = (id) => document.getElementById(id);

function base() { return ($('serviceUrl').value || DEFAULTS.serviceUrl).replace(/\/$/, ''); }

// Load local settings (enable/serviceUrl live in chrome.storage).
chrome.storage.local.get(DEFAULTS, (v) => {
  const s = Object.assign({}, DEFAULTS, v || {});
  $('enabled').checked = s.enabled;
  $('serviceUrl').value = s.serviceUrl;
  loadPreference();
});

$('enabled').addEventListener('change', () => chrome.storage.local.set({ enabled: $('enabled').checked }));
$('serviceUrl').addEventListener('change', () => chrome.storage.local.set({ serviceUrl: base() }));

$('ping').addEventListener('click', async () => {
  const el = $('status');
  el.textContent = '…'; el.className = '';
  try {
    const r = await fetch(base() + '/health');
    const d = await r.json();
    el.textContent = d && d.ok ? '✓ 已連線' : '無回應';
    el.className = d && d.ok ? 'ok' : 'bad';
  } catch {
    el.textContent = '✗ 連不上(服務有開嗎?)';
    el.className = 'bad';
  }
});

// Preference (extraKeywords) lives in the service, so it persists across machines/reloads.
async function loadPreference() {
  try {
    const r = await fetch(base() + '/preference');
    const p = await r.json();
    $('extra').value = (p.extraKeywords || []).join(', ');
  } catch { /* service down — leave blank */ }
}

$('savePref').addEventListener('click', async () => {
  const kws = $('extra').value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
  const el = $('prefStatus');
  try {
    await fetch(base() + '/preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extraKeywords: kws }),
    });
    el.textContent = '已儲存 ✓'; el.className = 'hint ok';
  } catch {
    el.textContent = '存不了(服務沒開)'; el.className = 'hint bad';
  }
});
