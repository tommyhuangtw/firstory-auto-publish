import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'podcast.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'db', 'schema.sql');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  _db = new Database(DB_PATH);

  // Performance settings
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Run schema migration
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  _db.exec(schema);

  // Add new columns if they don't exist (safe migration for existing DBs)
  const safeAlter = (sql: string) => {
    try { _db!.exec(sql); } catch { /* column already exists */ }
  };
  safeAlter('ALTER TABLE tools ADD COLUMN current_summary TEXT');
  safeAlter('ALTER TABLE tools ADD COLUMN summary_version INTEGER DEFAULT 0');
  safeAlter('ALTER TABLE tools ADD COLUMN latest_version_detail TEXT');
  safeAlter('ALTER TABLE tools ADD COLUMN family_id INTEGER REFERENCES tool_families(id)');
  safeAlter('ALTER TABLE episode_tool_mentions ADD COLUMN significance REAL DEFAULT 0.5');
  safeAlter('ALTER TABLE episode_tool_mentions ADD COLUMN version_detail TEXT');
  safeAlter('ALTER TABLE tools ADD COLUMN first_seen_date TEXT');
  safeAlter('ALTER TABLE tools ADD COLUMN latest_seen_date TEXT');
  safeAlter('ALTER TABLE episode_tool_mentions ADD COLUMN aired_date TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN youtube_description TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN ig_caption TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN script_summary TEXT');
  safeAlter('ALTER TABLE shorts ADD COLUMN avatar_filename TEXT');
  safeAlter('ALTER TABLE pipeline_runs ADD COLUMN episode_id INTEGER');
  safeAlter('ALTER TABLE llm_calls ADD COLUMN episode_id INTEGER');
  safeAlter('ALTER TABLE episode_tool_mentions ADD COLUMN episode_id INTEGER');
  safeAlter('ALTER TABLE shorts ADD COLUMN episode_id INTEGER');
  safeAlter('ALTER TABLE service_costs ADD COLUMN episode_id INTEGER');
  safeAlter('ALTER TABLE episodes ADD COLUMN source_links TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN cover_url TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN fb_post_id TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN fb_caption TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN threads_post_id TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN threads_caption TEXT');

  // Create indexes on new columns (after safe ALTER ensures columns exist)
  const safeIndex = (sql: string) => {
    try { _db!.exec(sql); } catch { /* index already exists */ }
  };
  safeIndex('CREATE INDEX IF NOT EXISTS idx_tools_family ON tools(family_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_mentions_significance ON episode_tool_mentions(significance)');

  // Seed tool families
  try {
    const { seedFamilies } = require('@/services/memory/toolFamilies');
    seedFamilies();
  } catch { /* toolFamilies not available during build */ }

  // Seed default settings
  const seedSetting = (key: string, value: string) => {
    _db!.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  };
  seedSetting('youtube_footer', `歡迎請我喝杯咖啡，幫助我繼續把節目做得更好唷～！
👉 https://buymeacoffee.com/ailanrenbao

---
🎙️ AI懶人報 Podcast — 每日 AI 精華，幫你降低資訊焦慮

📢 收聽更多平台：
Apple Podcast / Spotify / KKBOX
👉 https://portaly.cc/ailrb

💬 合作聯繫：ailanrenbao@gmail.com`);
  seedSetting('podcast_footer', `歡迎請我喝杯咖啡，幫助我繼續把節目做得更好唷～！
👉 https://buymeacoffee.com/ailanrenbao`);

  // Service cost pricing defaults
  seedSetting('usd_to_twd', '32.0');
  seedSetting('voai_cost_per_char_twd', '0.06');
  seedSetting('kieai_nano_banana_pro_usd', '0.09');
  seedSetting('kieai_veo3_fast_usd', '0.30');
  seedSetting('kieai_kling_i2v_usd', '0.55');
  seedSetting('kieai_nano_banana_edit_usd', '0.04');

  // Remove old youtube_ad_content setting (replaced by ad_presets table)
  _db!.prepare("DELETE FROM settings WHERE key = 'youtube_ad_content'").run();

  // Seed ad presets (only if table is empty)
  const presetCount = (_db!.prepare('SELECT COUNT(*) as c FROM ad_presets').get() as { c: number }).c;
  if (presetCount === 0) {
    const seedPreset = _db!.prepare('INSERT INTO ad_presets (name, content, is_active) VALUES (?, ?, ?)');
    seedPreset.run('企業 AI 落地計畫', `【 🚀 企業 AI 落地計畫：讓 AI 從玩具變成工具 】

當大家還在跟 AI 聊天，真正領先的企業已經將 AI 系統化落地。憑藉前美國 Tesla 軟體品質工程背景，我要幫你客製一套「穩健、精準」的 AI 系統，解決法律比對、單據入庫或診所餐廳預約等流程痛點。

🎯 限額 2 名：提供 50% 費用減免，打造 Tesla 等級的ＡＩ自動化大腦。

👉 立即填表申請： https://forms.gle/uDi4GV8arqJJkuXt9`, 1);

    seedPreset.run('VoAI 絕好聲創', `🚀 特別感謝贊助

本集節目由 VoAI 絕好聲創 提供技術支援。

🎤 VoAI 提供最有「台灣味」的 AI 聲音，支援情感語音、台式口音，甚至能一鍵生成虛擬人！

🎁 AI懶人報聽眾專屬優惠：
👉 輸入優惠碼 AILRB26 立享 95 折！
👉 API 方案用戶：透過專員聯繫並告知從「AI懶人報」來的，額外加贈 10% 使用額度！

立刻體驗：https://www.voai.ai/`, 0);

    seedPreset.run('AI Podcast 自動化流程', `🚀 【限時優惠】從每集 6 小時縮短至 20 分鐘的播客祕訣！
想做到一週五更、衝上科技榜前三名嗎？這套「AI Podcast 自動化流程 V2.0」幫我創造了 20 萬次下載，現在正式公開！從自動選題、在地化講稿到語音生成，讓你告別重複勞動。
🔥 原價 NT$5,990 ➡️ 限時優惠只要 NT$3,290
點擊加入自動化行列：https://portaly.cc/ailrb/product/8HzQAVA7ZeGBaPb3LuJK`, 0);

    seedPreset.run('BuildMoat 系統設計實戰營', `🚀【懶人報專屬好康】現代系統設計實戰營：矽谷大咖帶你突破職涯瓶頸！
在 AI 時代，寫 Code 漂亮不再是唯一指標，「系統架構能力」才是面試大廠（Google、Meta、OpenAI）勝出的關鍵護城河！

這門課由兩位矽谷老將親自帶領：
🤖 Terry Chen（10 年矽谷經驗、50 萬訂閱 YouTuber）
🤖 Bohr Wang（曾任職於 OpenAI、Google、Meta 的主任工程師）

💡 你將學會：
👉 大廠實戰架構： 拆解 Spotify 排行榜、Tesla RoboTaxi、YouTube 等千萬級流量系統。
👉 不可替代性： 掌握 AI 無法代勞的決策力（資料庫選擇、高併發處理、架構省錢術）。
👉 最新 AI 應用： 實戰 RAG 智能系統與 MCP 協議 Agent 架構。

🔥懶人報聽眾限定：超過 5 折超狂優惠！
現在點擊下方連結結帳，直接享有專屬「半價以上」折扣，投資自己職涯的最高槓桿：
👉 專屬優惠連結：
https://www.buildmoat.org/?promo_code=promo_1TIqotIXmUwiEgU6tciLjSiI`, 0);

    seedPreset.run('AI 懶人報自動化祕密', `🔥 《AI 懶人報》一週五更、16 萬人次、科技榜 #2 的自動化祕密公開！
想知道如何用 AI 打造一套能衝榜、還能接到 NordVPN 業配的「自動化內容產線」嗎？
我直接拆解了 104 個 n8n 節點流程與完整 Prompts，把這套獲利思維送給你。
(內容包含：自動選題、台灣口音校對、業配自動插入、多路發布系統)

🎁 原價 NT. 5,990，現在限時 5 折優惠（NT. 2,990）：
👉 優惠連結：
portaly.cc/ailrb/product/8HzQAVA7ZeGBaPb3LuJK`, 0);

    seedPreset.run('無業配', '', 0);
  }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
