/**
 * 10 種新縮圖風格 — 基於 Minimal Clean / Side Panel / Magazine 方向延伸
 */

function calcFontSize(text, base) {
  const len = text.replace(/<[^>]*>/g, '').length;
  if (len > 50) return Math.round(base * 0.65);
  if (len > 40) return Math.round(base * 0.75);
  if (len > 30) return Math.round(base * 0.85);
  return base;
}

function escapeHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const COMMON_HEAD = `<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&family=Playfair+Display:wght@700;900&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1280px; height:720px; font-family:'Noto Sans TC',sans-serif; overflow:hidden; }
</style>`;

// ── 6. Minimal Left-Align — 左對齊極簡，底部窄色帶 ──
function styleMinimalLeftAlign({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 50);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; position:relative; ${bgImg} }
.overlay { position:absolute; inset:0; background:rgba(0,0,0,0.5); }
.content { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; justify-content:flex-end; padding:0 60px 0 60px; }
.top { position:absolute; top:28px; left:60px; z-index:10; display:flex; align-items:center; gap:14px; }
.brand-line { color:#fff; font-size:17px; font-weight:700; letter-spacing:2px; opacity:0.85; }
.dot { color:rgba(255,255,255,0.4); }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.35; max-width:1000px; margin-bottom:20px; }
.bar { width:100%; height:56px; background:linear-gradient(90deg, #FF6B35, #F7C948); display:flex; align-items:center; padding:0 60px; }
.bar-text { color:#fff; font-size:14px; font-weight:700; letter-spacing:2px; }
.bar-right { margin-left:auto; color:rgba(255,255,255,0.85); font-size:13px; }
</style></head><body>
<div class="wrap"><div class="overlay"></div>
  <div class="top"><span class="brand-line">${brandName}</span><span class="dot">·</span><span class="brand-line">EP${episodeNumber}</span></div>
  <div class="content"><div class="title">${escapedTitle}</div></div>
  <div class="bar"><span class="bar-text">DAILY AI PODCAST</span><span class="bar-right">每日精華 · 15-20 分鐘</span></div>
</div></body></html>`;
}

// ── 7. Side Panel Dark — 左深色面板，金色強調 ──
function styleSidePanelDark({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 40);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; display:flex; }
.left { width:480px; height:720px; background:#0a0a0a; display:flex; flex-direction:column; justify-content:center; padding:48px 40px; position:relative; }
.left::after { content:''; position:absolute; top:60px; right:0; bottom:60px; width:3px; background:linear-gradient(180deg,transparent,#F7C948,transparent); }
.brand-row { display:flex; align-items:center; gap:10px; margin-bottom:28px; }
.brand-sq { width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg,#F7C948,#FF6B35); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; color:#000; }
.brand-label { color:rgba(255,255,255,0.6); font-size:15px; font-weight:700; letter-spacing:1px; }
.ep { font-size:13px; font-weight:700; color:#F7C948; letter-spacing:4px; margin-bottom:10px; }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.45; }
.divider { width:36px; height:2px; background:#F7C948; margin-top:20px; }
.hint { margin-top:14px; color:rgba(255,255,255,0.3); font-size:12px; }
.right { flex:1; height:720px; ${bgImg} position:relative; }
.right-ov { position:absolute; inset:0; background:linear-gradient(90deg,rgba(10,10,10,0.5) 0%,transparent 50%); }
</style></head><body>
<div class="wrap">
  <div class="left">
    <div class="brand-row"><div class="brand-sq">AI</div><div class="brand-label">${brandName}</div></div>
    <div class="ep">EPISODE ${episodeNumber}</div>
    <div class="title">${escapedTitle}</div>
    <div class="divider"></div>
    <div class="hint">每日 AI 精華 · 15-20 分鐘</div>
  </div>
  <div class="right"><div class="right-ov"></div></div>
</div></body></html>`;
}

// ── 8. Magazine Bold — 雜誌粗體，大集數背景 ──
function styleMagazineBold({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 54);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; position:relative; ${bgImg} }
.overlay { position:absolute; inset:0; background:linear-gradient(160deg,rgba(0,0,0,0.75) 0%,rgba(0,0,0,0.4) 40%,rgba(0,0,0,0.8) 100%); }
.ep-bg { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-family:'Playfair Display',serif; font-size:360px; font-weight:900; color:rgba(255,255,255,0.04); z-index:1; line-height:1; }
.header { position:absolute; top:0; left:0; right:0; z-index:10; display:flex; align-items:center; padding:24px 40px; }
.brand-name { font-size:22px; font-weight:900; color:#fff; letter-spacing:3px; }
.header-line { flex:1; height:1px; background:rgba(255,255,255,0.15); margin:0 20px; }
.ep-text { font-size:15px; color:rgba(255,255,255,0.5); letter-spacing:3px; font-weight:700; }
.center { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; justify-content:center; padding:0 80px; }
.cat { font-size:12px; font-weight:700; letter-spacing:4px; color:#F7C948; margin-bottom:16px; }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.3; max-width:950px; }
.sub { margin-top:18px; color:rgba(255,255,255,0.45); font-size:15px; }
</style></head><body>
<div class="wrap"><div class="overlay"></div>
  <div class="ep-bg">${episodeNumber}</div>
  <div class="header"><div class="brand-name">${brandName}</div><div class="header-line"></div><div class="ep-text">EP${episodeNumber}</div></div>
  <div class="center">
    <div class="cat">DAILY AI PODCAST</div>
    <div class="title">${escapedTitle}</div>
    <div class="sub">降低資訊焦慮，專注實用變革</div>
  </div>
</div></body></html>`;
}

// ── 9. Clean Card — 白色卡片浮在封面上 ──
function styleCleanCard({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 40);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; position:relative; ${bgImg} }
.overlay { position:absolute; inset:0; background:rgba(0,0,0,0.35); }
.card { position:absolute; bottom:32px; left:32px; right:32px; z-index:10; background:rgba(255,255,255,0.95); border-radius:16px; padding:32px 40px; display:flex; flex-direction:column; }
.card-top { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
.brand-tag { background:#111; color:#fff; padding:5px 14px; border-radius:6px; font-size:13px; font-weight:900; letter-spacing:1px; }
.ep-tag { color:#666; font-size:13px; font-weight:700; letter-spacing:2px; }
.card-title { color:#111; font-size:${fs}px; font-weight:900; line-height:1.35; }
.card-sub { margin-top:12px; color:#999; font-size:13px; display:flex; align-items:center; gap:8px; }
.card-dot { width:6px; height:6px; border-radius:50%; background:#FF6B35; }
</style></head><body>
<div class="wrap"><div class="overlay"></div>
  <div class="card">
    <div class="card-top"><div class="brand-tag">${brandName}</div><div class="ep-tag">EP${episodeNumber}</div></div>
    <div class="card-title">${escapedTitle}</div>
    <div class="card-sub"><div class="card-dot"></div>每日 AI 精華 · 15-20 分鐘</div>
  </div>
</div></body></html>`;
}

// ── 10. Split Diagonal — 對角線切割 ──
function styleSplitDiagonal({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 44);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; position:relative; ${bgImg} }
.overlay { position:absolute; inset:0; background:rgba(0,0,0,0.25); }
.diagonal { position:absolute; inset:0; z-index:5;
  background: linear-gradient(155deg, #111827 48%, transparent 48.5%);
}
.content { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; justify-content:center; padding:48px 56px; max-width:600px; }
.brand-row { display:flex; align-items:center; gap:10px; margin-bottom:24px; }
.brand-circle { width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#FF6B35,#F7C948); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; color:#fff; }
.brand-label { color:rgba(255,255,255,0.7); font-size:15px; font-weight:700; }
.ep { font-size:12px; color:#F7C948; letter-spacing:3px; font-weight:700; margin-bottom:8px; }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.4; }
.accent { width:40px; height:3px; background:#F7C948; margin-top:18px; border-radius:2px; }
.hint { margin-top:12px; color:rgba(255,255,255,0.35); font-size:12px; }
</style></head><body>
<div class="wrap"><div class="overlay"></div><div class="diagonal"></div>
  <div class="content">
    <div class="brand-row"><div class="brand-circle">AI</div><div class="brand-label">${brandName}</div></div>
    <div class="ep">EPISODE ${episodeNumber}</div>
    <div class="title">${escapedTitle}</div>
    <div class="accent"></div>
    <div class="hint">每日 AI 精華 · 15-20 分鐘</div>
  </div>
</div></body></html>`;
}

// ── 11. Bottom Strip — 底部窄條重點標題 ──
function styleBottomStrip({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 46);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; position:relative; ${bgImg} }
.overlay { position:absolute; inset:0; background:linear-gradient(180deg,transparent 50%,rgba(0,0,0,0.75) 100%); }
.top-bar { position:absolute; top:0; left:0; right:0; z-index:10; height:4px; background:linear-gradient(90deg,#FF6B35,#F7C948,#FF6B35); }
.brand { position:absolute; top:20px; left:28px; z-index:10; display:flex; align-items:center; gap:8px; }
.brand-icon { width:32px; height:32px; border-radius:6px; background:#fff; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:900; color:#111; }
.brand-text { color:#fff; font-size:16px; font-weight:700; text-shadow:0 1px 6px rgba(0,0,0,0.5); }
.ep { position:absolute; top:22px; right:28px; z-index:10; color:#fff; font-size:18px; font-weight:900; text-shadow:0 1px 6px rgba(0,0,0,0.5); }
.bottom { position:absolute; bottom:0; left:0; right:0; z-index:10; background:rgba(17,24,39,0.92); padding:24px 48px; display:flex; align-items:center; gap:24px; }
.ep-big { font-size:36px; font-weight:900; color:#F7C948; white-space:nowrap; }
.sep { width:2px; height:48px; background:rgba(255,255,255,0.15); }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.3; }
</style></head><body>
<div class="wrap"><div class="overlay"></div>
  <div class="top-bar"></div>
  <div class="brand"><div class="brand-icon">AI</div><div class="brand-text">${brandName}</div></div>
  <div class="ep">EP${episodeNumber}</div>
  <div class="bottom">
    <div class="ep-big">EP${episodeNumber}</div>
    <div class="sep"></div>
    <div class="title">${escapedTitle}</div>
  </div>
</div></body></html>`;
}

// ── 12. Side Panel White — 白底左面板 ──
function styleSidePanelWhite({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 38);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; display:flex; }
.left { width:500px; height:720px; background:#fafafa; display:flex; flex-direction:column; justify-content:center; padding:48px 44px; position:relative; }
.left::after { content:''; position:absolute; top:0; right:0; width:5px; height:100%; background:linear-gradient(180deg,#FF6B35,#F7C948); }
.brand-row { display:flex; align-items:center; gap:10px; margin-bottom:28px; }
.brand-sq { width:40px; height:40px; border-radius:10px; background:#111; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; color:#fff; }
.brand-label { color:#333; font-size:16px; font-weight:900; letter-spacing:1px; }
.ep { font-size:13px; font-weight:700; color:#FF6B35; letter-spacing:3px; margin-bottom:8px; }
.title { color:#111; font-size:${fs}px; font-weight:900; line-height:1.4; }
.divider { width:36px; height:3px; background:#111; margin-top:20px; border-radius:2px; }
.hint { margin-top:14px; color:#aaa; font-size:12px; }
.right { flex:1; height:720px; ${bgImg} position:relative; }
.right-ov { position:absolute; inset:0; background:linear-gradient(90deg,rgba(250,250,250,0.3) 0%,transparent 30%); }
</style></head><body>
<div class="wrap">
  <div class="left">
    <div class="brand-row"><div class="brand-sq">AI</div><div class="brand-label">${brandName}</div></div>
    <div class="ep">EPISODE ${episodeNumber}</div>
    <div class="title">${escapedTitle}</div>
    <div class="divider"></div>
    <div class="hint">每日 AI 精華 · 15-20 分鐘</div>
  </div>
  <div class="right"><div class="right-ov"></div></div>
</div></body></html>`;
}

// ── 13. Minimal Center — 置中極簡大標題 ──
function styleMinimalCenter({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 54);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; position:relative; ${bgImg} }
.overlay { position:absolute; inset:0; background:rgba(0,0,0,0.6); }
.content { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:0 100px; }
.top-line { display:flex; align-items:center; gap:16px; margin-bottom:28px; }
.line { width:40px; height:1px; background:rgba(255,255,255,0.3); }
.brand { color:rgba(255,255,255,0.6); font-size:14px; font-weight:700; letter-spacing:4px; }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.35; }
.bottom-line { display:flex; align-items:center; gap:16px; margin-top:24px; }
.ep { color:#F7C948; font-size:14px; font-weight:700; letter-spacing:3px; }
.hint { color:rgba(255,255,255,0.35); font-size:13px; }
</style></head><body>
<div class="wrap"><div class="overlay"></div>
  <div class="content">
    <div class="top-line"><div class="line"></div><div class="brand">${brandName}</div><div class="line"></div></div>
    <div class="title">${escapedTitle}</div>
    <div class="bottom-line"><div class="ep">EP${episodeNumber}</div><span style="color:rgba(255,255,255,0.2)">·</span><div class="hint">每日 AI 精華</div></div>
  </div>
</div></body></html>`;
}

// ── 14. Magazine Elegant — 優雅雜誌，serif 混搭 ──
function styleMagazineElegant({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 46);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; position:relative; ${bgImg} }
.overlay { position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,0.1) 0%,rgba(0,0,0,0.7) 100%); }
.border { position:absolute; top:16px; left:16px; right:16px; bottom:16px; border:1px solid rgba(255,255,255,0.15); z-index:5; border-radius:4px; }
.header { position:absolute; top:32px; left:40px; right:40px; z-index:10; display:flex; align-items:center; justify-content:space-between; }
.brand { font-size:20px; font-weight:900; color:#fff; letter-spacing:4px; }
.ep { font-family:'Playfair Display',serif; font-size:18px; color:rgba(255,255,255,0.6); letter-spacing:2px; }
.bottom { position:absolute; bottom:0; left:0; right:0; z-index:10; padding:0 56px 48px; }
.cat { font-size:11px; letter-spacing:5px; color:#F7C948; font-weight:700; margin-bottom:14px; }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.35; max-width:900px; }
.meta { margin-top:16px; display:flex; align-items:center; gap:16px; }
.meta-item { color:rgba(255,255,255,0.4); font-size:12px; letter-spacing:1px; }
.meta-dot { width:4px; height:4px; border-radius:50%; background:rgba(255,255,255,0.2); }
</style></head><body>
<div class="wrap"><div class="overlay"></div><div class="border"></div>
  <div class="header"><div class="brand">${brandName}</div><div class="ep">No. ${episodeNumber}</div></div>
  <div class="bottom">
    <div class="cat">DAILY AI PODCAST</div>
    <div class="title">${escapedTitle}</div>
    <div class="meta"><div class="meta-item">每日精華</div><div class="meta-dot"></div><div class="meta-item">15-20 MIN</div><div class="meta-dot"></div><div class="meta-item">降低資訊焦慮</div></div>
  </div>
</div></body></html>`;
}

// ── 15. Side Panel Gradient — 漸層左面板 ──
function styleSidePanelGradient({ escapedTitle, episodeNumber, brandName, bgImg }) {
  const fs = calcFontSize(escapedTitle, 40);
  return `<!DOCTYPE html><html><head>${COMMON_HEAD}<style>
.wrap { width:1280px; height:720px; display:flex; position:relative; }
.left { width:520px; height:720px; background:linear-gradient(180deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%); display:flex; flex-direction:column; justify-content:center; padding:48px 44px; position:relative; z-index:2; }
.left::after { content:''; position:absolute; top:0; right:-30px; width:60px; height:100%; background:linear-gradient(90deg,#0f3460,transparent); z-index:1; }
.brand-row { display:flex; align-items:center; gap:12px; margin-bottom:32px; }
.brand-ring { width:42px; height:42px; border-radius:50%; border:2px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; color:#fff; }
.brand-label { color:rgba(255,255,255,0.7); font-size:16px; font-weight:700; letter-spacing:2px; }
.ep { display:inline-block; padding:4px 14px; border:1px solid rgba(247,201,72,0.4); border-radius:4px; font-size:12px; color:#F7C948; letter-spacing:3px; font-weight:700; margin-bottom:14px; }
.title { color:#fff; font-size:${fs}px; font-weight:900; line-height:1.4; }
.glow-line { width:50px; height:3px; background:linear-gradient(90deg,#e94560,#F7C948); margin-top:20px; border-radius:2px; box-shadow:0 0 8px rgba(233,69,96,0.4); }
.hint { margin-top:14px; color:rgba(255,255,255,0.3); font-size:12px; letter-spacing:1px; }
.right { flex:1; height:720px; ${bgImg} position:relative; }
</style></head><body>
<div class="wrap">
  <div class="left">
    <div class="brand-row"><div class="brand-ring">AI</div><div class="brand-label">${brandName}</div></div>
    <div class="ep">EPISODE ${episodeNumber}</div>
    <div class="title">${escapedTitle}</div>
    <div class="glow-line"></div>
    <div class="hint">每日 AI 精華 · 15-20 分鐘</div>
  </div>
  <div class="right"></div>
</div></body></html>`;
}

const STYLE_MAP = {
  'minimal-left-align': styleMinimalLeftAlign,
  'side-panel-dark': styleSidePanelDark,
  'magazine-bold': styleMagazineBold,
  'clean-card': styleCleanCard,
  'split-diagonal': styleSplitDiagonal,
  'bottom-strip': styleBottomStrip,
  'side-panel-white': styleSidePanelWhite,
  'minimal-center': styleMinimalCenter,
  'magazine-elegant': styleMagazineElegant,
  'side-panel-gradient': styleSidePanelGradient,
};

module.exports = { STYLE_MAP, calcFontSize, escapeHtml };
