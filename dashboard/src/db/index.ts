import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as sqliteVec from 'sqlite-vec';
// Static imports (not runtime require) — getDb is a hoisted function and these
// seed helpers only call it at runtime, so the db <-> seed cycle resolves safely.
// Avoids the Turbopack "require() of ESM returns undefined exports" load-order trap.
import { seedFamilies } from '@/services/memory/toolFamilies';
import { seedThumbnailStyles, reconcileStyleUsage } from '@/services/thumbnailStyles';

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

  // Vector search extension (sqlite-vec). Must load before creating vec0 tables.
  try {
    sqliteVec.load(_db);
    _db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS vec_insights USING vec0(embedding float[1536])');
  } catch (e) {
    console.error('sqlite-vec load failed:', (e as Error).message);
  }

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
  safeAlter('ALTER TABLE episodes ADD COLUMN ig_holiday TEXT');
  safeAlter('ALTER TABLE thumbnail_styles ADD COLUMN usage_count INTEGER DEFAULT 0');
  safeAlter('ALTER TABLE substack_drafts ADD COLUMN images_json TEXT');
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
  safeAlter('ALTER TABLE llm_calls ADD COLUMN input_messages TEXT');
  safeAlter('ALTER TABLE llm_calls ADD COLUMN output_content TEXT');
  safeAlter('ALTER TABLE shorts ADD COLUMN yt_video_id TEXT');
  safeAlter('ALTER TABLE shorts ADD COLUMN yt_video_url TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN yt_thumbnail_path TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN yt_hook_title TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN original_audio_path TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN audio_duration_sec REAL');
  safeAlter('ALTER TABLE episodes ADD COLUMN title_history TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN hook_title_history TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN sponsor_audio_id INTEGER REFERENCES sponsor_audio_presets(id)');
  safeAlter('ALTER TABLE episodes ADD COLUMN sponsor_original_audio_path TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN sponsor_original_srt_content TEXT');
  safeAlter('ALTER TABLE sponsor_audio_presets ADD COLUMN ad_preset_id INTEGER REFERENCES ad_presets(id)');
  safeAlter('ALTER TABLE sponsor_audio_presets ADD COLUMN audio_merge_enabled INTEGER DEFAULT 1');
  // Cached subtitles for the sponsor口播 (transcribed once per preset, reused across episodes)
  safeAlter('ALTER TABLE sponsor_audio_presets ADD COLUMN srt_content TEXT');
  // Sponsor selection is now per-episode at review time — drop the date/expiry auto-selection columns
  safeAlter('ALTER TABLE sponsor_audio_presets DROP COLUMN scheduled_dates');
  safeAlter('ALTER TABLE sponsor_audio_presets DROP COLUMN expires_at');
  safeAlter('ALTER TABLE episodes ADD COLUMN srt_path TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN srt_content TEXT');
  safeAlter('ALTER TABLE episodes ADD COLUMN version_check TEXT');

  // Create indexes on new columns (after safe ALTER ensures columns exist)
  const safeIndex = (sql: string) => {
    try { _db!.exec(sql); } catch { /* index already exists */ }
  };
  safeIndex('CREATE INDEX IF NOT EXISTS idx_tools_family ON tools(family_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_mentions_significance ON episode_tool_mentions(significance)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category)');
  safeAlter('ALTER TABLE tasks ADD COLUMN completed_by TEXT DEFAULT NULL');
  safeAlter('ALTER TABLE tasks ADD COLUMN images TEXT DEFAULT NULL');

  // task_comments table
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author      TEXT    NOT NULL DEFAULT 'hermes',
      type        TEXT    NOT NULL DEFAULT 'action',
      content     TEXT    NOT NULL,
      metadata    TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id)');

  // YouTube analytics tables
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS youtube_channel_stats (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date   TEXT    NOT NULL,
      subscriber_count INTEGER DEFAULT 0,
      view_count      INTEGER DEFAULT 0,
      video_count     INTEGER DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_yt_channel_date ON youtube_channel_stats(snapshot_date)');

  _db!.exec(`
    CREATE TABLE IF NOT EXISTS youtube_video_stats (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id      TEXT    NOT NULL,
      title         TEXT,
      published_at  TEXT,
      snapshot_date TEXT    NOT NULL,
      views         INTEGER DEFAULT 0,
      likes         INTEGER DEFAULT 0,
      comments      INTEGER DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_yt_video_composite ON youtube_video_stats(video_id, snapshot_date)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_yt_video_date ON youtube_video_stats(snapshot_date)');

  // Knowledge docs table
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      filename    TEXT    UNIQUE NOT NULL,
      title       TEXT    NOT NULL,
      category    TEXT    NOT NULL DEFAULT 'research',
      task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      word_count  INTEGER,
      created_at  TEXT    DEFAULT (datetime('now')),
      indexed_at  TEXT    DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_knowledge_docs_category ON knowledge_docs(category)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_knowledge_docs_task ON knowledge_docs(task_id)');

  // Content summaries table (Task #10)
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS content_summaries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      url           TEXT    NOT NULL,
      source_type   TEXT    NOT NULL,
      title         TEXT,
      channel_name  TEXT,
      thumbnail_url TEXT,
      transcript    TEXT,
      summary_json  TEXT,
      status        TEXT    NOT NULL DEFAULT 'pending',
      error_message TEXT,
      cost_usd      REAL    DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now')),
      completed_at  TEXT
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_content_summaries_status ON content_summaries(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_content_summaries_type ON content_summaries(source_type)');
  safeAlter('ALTER TABLE content_summaries ADD COLUMN channel_id INTEGER');
  safeAlter('ALTER TABLE content_summaries ADD COLUMN external_id TEXT');
  // Original publish date of the source video/episode (ISO). Distinct from created_at (ingest time).
  safeAlter('ALTER TABLE content_summaries ADD COLUMN published_at TEXT');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_content_summaries_external ON content_summaries(external_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_content_summaries_channel ON content_summaries(channel_id)');

  // Multi-Agent System tables
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS agent_discussions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       INTEGER REFERENCES tasks(id),
      session_id    TEXT    NOT NULL,
      agent_id      TEXT    NOT NULL,
      agent_name    TEXT    NOT NULL,
      message_type  TEXT    NOT NULL,
      content       TEXT    NOT NULL,
      token_usage   INTEGER,
      duration_ms   INTEGER,
      created_at    TEXT    DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_agent_disc_session ON agent_discussions(session_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_agent_disc_task ON agent_discussions(task_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_agent_disc_agent ON agent_discussions(agent_id)');

  _db!.exec(`
    CREATE TABLE IF NOT EXISTS agent_proposals (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id          TEXT    NOT NULL,
      proposed_by         TEXT    NOT NULL,
      proposal_type       TEXT    NOT NULL,
      title               TEXT    NOT NULL,
      description         TEXT    NOT NULL,
      priority_suggestion TEXT,
      pm_decision         TEXT,
      pm_reasoning        TEXT,
      task_id             INTEGER,
      created_at          TEXT    DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_agent_prop_decision ON agent_proposals(pm_decision)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_agent_prop_by ON agent_proposals(proposed_by)');

  _db!.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      source_agent        TEXT    NOT NULL,
      alert_type          TEXT    NOT NULL,
      title               TEXT    NOT NULL,
      description         TEXT    NOT NULL,
      urgency             TEXT    NOT NULL DEFAULT 'normal',
      status              TEXT    NOT NULL DEFAULT 'unread',
      related_task_id     INTEGER,
      related_proposal_id INTEGER,
      telegram_sent       INTEGER DEFAULT 0,
      created_at          TEXT    DEFAULT (datetime('now')),
      actioned_at         TEXT
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_alerts_urgency ON alerts(urgency)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_alerts_agent ON alerts(source_agent)');

  _db!.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id        TEXT    NOT NULL,
      memory_type     TEXT    NOT NULL,
      topic           TEXT    NOT NULL,
      current_summary TEXT    NOT NULL,
      summary_version INTEGER DEFAULT 1,
      last_updated    TEXT    DEFAULT (datetime('now')),
      UNIQUE(agent_id, topic)
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_agent_mem_agent ON agent_memory(agent_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_agent_mem_updated ON agent_memory(last_updated)');

  // Social trend bot tables (蹭大眾熱點 → 爆紅貼文草稿)
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS trend_topics (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      topic         TEXT    NOT NULL,
      heat_score    REAL    DEFAULT 0,
      rideability   REAL,
      risk_level    TEXT,
      risk_reason   TEXT,
      sample_posts  TEXT,
      post_count    INTEGER DEFAULT 0,
      top_velocity  REAL    DEFAULT 0,
      status        TEXT    NOT NULL DEFAULT 'new',
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_topics_status ON trend_topics(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_topics_created ON trend_topics(created_at)');

  _db!.exec(`
    CREATE TABLE IF NOT EXISTS trend_drafts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id          INTEGER REFERENCES trend_topics(id) ON DELETE CASCADE,
      draft_text        TEXT    NOT NULL,
      format_suggestion TEXT    NOT NULL DEFAULT 'text',
      format_reason     TEXT,
      char_count        INTEGER,
      status            TEXT    NOT NULL DEFAULT 'pending_review',
      task_id           INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      reviewed_at       TEXT,
      created_at        TEXT    DEFAULT (datetime('now')),
      updated_at        TEXT    DEFAULT (datetime('now'))
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_drafts_status ON trend_drafts(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_drafts_topic ON trend_drafts(topic_id)');

  // Every scraped post is recorded here for later tracking (clickable permalinks).
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS trend_posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id    INTEGER REFERENCES trend_topics(id) ON DELETE CASCADE,
      topic       TEXT,
      source      TEXT,
      author      TEXT,
      text        TEXT,
      like_count  INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      velocity    REAL    DEFAULT 0,
      posted_at   TEXT,
      permalink   TEXT,
      relevant    INTEGER DEFAULT 0,
      embedding   TEXT,
      interested  INTEGER DEFAULT 0,
      scraped_at  TEXT    DEFAULT (datetime('now'))
    )
  `);
  safeAlter('ALTER TABLE trend_posts ADD COLUMN source TEXT');
  safeAlter('ALTER TABLE trend_posts ADD COLUMN relevant INTEGER DEFAULT 0');
  safeAlter('ALTER TABLE trend_posts ADD COLUMN embedding TEXT');           // OpenAI vector (JSON)
  safeAlter('ALTER TABLE trend_posts ADD COLUMN interested INTEGER DEFAULT 0'); // 👍 想留
  safeAlter('ALTER TABLE trend_posts ADD COLUMN scan_run_id INTEGER');         // which scan recorded it
  safeAlter('ALTER TABLE trend_posts ADD COLUMN niche INTEGER DEFAULT 0');      // 回覆專區命中(niche keyword + 讚≥30 + 近2天)
  safeAlter('ALTER TABLE trend_posts ADD COLUMN reply_draft TEXT');             // AI 生成的回覆草稿
  safeAlter('ALTER TABLE trend_posts ADD COLUMN dismissed INTEGER DEFAULT 0');   // 回覆專區手動移除(看過了)
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_posts_niche ON trend_posts(niche)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_posts_interested ON trend_posts(interested)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_posts_topic ON trend_posts(topic_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_posts_permalink ON trend_posts(permalink)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_posts_scraped ON trend_posts(scraped_at)');

  // Per-scan audit log: when it ran, topics searched, the full funnel, and EVERY dropped
  // post with its filter reason (below_floor / stale / duplicate). Lets Tommy review each crawl.
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS trend_scan_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at  TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      trigger     TEXT,        -- 'manual' | 'scheduled' | 'catchup'
      topics      TEXT,        -- JSON: topics searched (incl 為你推薦)
      scraped     INTEGER DEFAULT 0,
      below_floor INTEGER DEFAULT 0,
      stale       INTEGER DEFAULT 0,
      deduped     INTEGER DEFAULT 0,
      recorded    INTEGER DEFAULT 0,
      dropped     TEXT,        -- JSON: [{a,t,e,r,p}] dropped posts + reason
      error       TEXT
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_trend_scan_runs_started ON trend_scan_runs(started_at)');

  // Resources curation tables (學習資源策展：爬 → 評分 → Threads 草稿)
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS curated_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guid TEXT UNIQUE NOT NULL,
      content_type TEXT NOT NULL,
      title TEXT,
      description TEXT,
      url TEXT,
      author TEXT,
      published_at TEXT,
      source TEXT,
      stars INTEGER,
      likes INTEGER,
      comments INTEGER,
      reposts INTEGER,
      last_stars INTEGER,
      last_stars_at TEXT,
      star_velocity REAL,
      social_buzz REAL DEFAULT 0,
      freshness_score REAL DEFAULT 0,
      freshness_reason TEXT,
      ai_score REAL,
      ai_summary TEXT,
      ai_reasoning TEXT,
      ai_highlights TEXT,
      ai_angle TEXT,
      status TEXT DEFAULT 'new',
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_surfaced_at TEXT,
      scan_run_id INTEGER
    )
  `);
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS resource_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_guid TEXT NOT NULL,
      draft_text TEXT,
      viral_score REAL,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS resource_scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      trigger TEXT,
      scraped INTEGER DEFAULT 0,
      below_gate INTEGER DEFAULT 0,
      deduped INTEGER DEFAULT 0,
      scored INTEGER DEFAULT 0,
      drafted INTEGER DEFAULT 0,
      recorded INTEGER DEFAULT 0,
      error TEXT,
      dropped TEXT,
      cost_usd REAL DEFAULT 0
    )
  `);
  safeAlter('ALTER TABLE resource_scan_runs ADD COLUMN cost_usd REAL DEFAULT 0'); // 既有 DB 補欄位
  safeAlter('ALTER TABLE curated_resources ADD COLUMN ai_summary TEXT');           // 中文重點說明
  safeAlter('ALTER TABLE curated_resources ADD COLUMN likes INTEGER');             // X 讚數
  safeAlter('ALTER TABLE curated_resources ADD COLUMN comments INTEGER');          // X 留言數
  safeAlter('ALTER TABLE curated_resources ADD COLUMN reposts INTEGER');           // X 轉推數
  safeIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_curated_resources_guid ON curated_resources(guid)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_curated_resources_status ON curated_resources(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_resource_drafts_guid ON resource_drafts(resource_guid)');

  // Inspiration Library tables (insights + insight_drafts)
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS insights (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id   INTEGER NOT NULL REFERENCES content_summaries(id) ON DELETE CASCADE,
      hook        TEXT    NOT NULL,
      idea        TEXT    NOT NULL,
      why_share   TEXT,
      category    TEXT,
      resonance   REAL,
      embedding   TEXT,
      origin      TEXT    NOT NULL DEFAULT 'ai_mined',
      status      TEXT    NOT NULL DEFAULT 'new',
      source_ts   TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    )
  `);

  _db!.exec(`
    CREATE TABLE IF NOT EXISTS insight_drafts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      insight_id  INTEGER NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
      user_note   TEXT,
      draft_text  TEXT    NOT NULL,
      platform    TEXT    NOT NULL DEFAULT 'threads',
      status      TEXT    NOT NULL DEFAULT 'pending_review',
      created_at  TEXT    DEFAULT (datetime('now'))
    )
  `);

  safeIndex('CREATE INDEX IF NOT EXISTS idx_insights_source ON insights(source_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_insights_resonance ON insights(resonance)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_insights_source_ts ON insights(source_ts)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_insight_drafts_insight ON insight_drafts(insight_id)');

  // Channel Registry (Task: Channel Registry + Incremental Crawl)
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      platform            TEXT    NOT NULL DEFAULT 'youtube',
      handle              TEXT,
      channel_id          TEXT    UNIQUE,
      uploads_playlist_id TEXT,
      title               TEXT,
      thumbnail_url       TEXT,
      active              INTEGER NOT NULL DEFAULT 1,
      fetch_count         INTEGER NOT NULL DEFAULT 5,
      last_crawled_at     TEXT,
      created_at          TEXT    DEFAULT (datetime('now'))
    )
  `);

  // Theme Tags tables (Sub-project C — Auto Theme Tags).
  // NOTE: a separate `themes` table already exists for the legacy memory/tool system;
  // inspiration themes use their OWN table to avoid polluting it.
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS inspiration_themes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      description   TEXT,
      embedding     TEXT,
      insight_count INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `);
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS insight_themes (
      insight_id INTEGER NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
      theme_id   INTEGER NOT NULL REFERENCES inspiration_themes(id) ON DELETE CASCADE,
      score      REAL,
      PRIMARY KEY (insight_id, theme_id)
    )
  `);
  safeIndex('CREATE INDEX IF NOT EXISTS idx_insight_themes_theme ON insight_themes(theme_id)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_insight_themes_insight ON insight_themes(insight_id)');

  // Personal Threads Voice Corpus (scope A) — ingest own Threads posts + insights,
  // distil into editable voice assets (bio / style / story). See spec:
  // docs/superpowers/specs/2026-06-25-threads-voice-corpus-design.md
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS threads_posts (
      post_id          TEXT PRIMARY KEY,
      text             TEXT,
      media_type       TEXT,
      permalink        TEXT,
      posted_at        TEXT,
      views            INTEGER DEFAULT 0,
      likes            INTEGER DEFAULT 0,
      replies          INTEGER DEFAULT 0,
      reposts          INTEGER DEFAULT 0,
      quotes           INTEGER DEFAULT 0,
      shares           INTEGER DEFAULT 0,
      engagement_rate  REAL    DEFAULT 0,
      is_repost        INTEGER DEFAULT 0,
      embedding        TEXT,
      fetched_at       TEXT    DEFAULT (datetime('now')),
      insights_at      TEXT
    )
  `);
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS voice_assets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      type           TEXT NOT NULL,                       -- 'bio' | 'style' | 'story'
      content        TEXT NOT NULL,
      topic_tags     TEXT,                                -- JSON array (mainly for stories)
      source_post_id TEXT,                                -- origin post for a story (nullable)
      pinned         INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'draft',       -- 'draft' | 'kept' | 'hidden'
      embedding      TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    )
  `);
  // Embedding columns for the voice writer (added post-hoc for existing DBs).
  safeAlter('ALTER TABLE threads_posts ADD COLUMN embedding TEXT');
  safeAlter('ALTER TABLE voice_assets ADD COLUMN embedding TEXT');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_threads_posts_engagement ON threads_posts(engagement_rate)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_threads_posts_posted ON threads_posts(posted_at)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_voice_assets_type ON voice_assets(type)');
  safeIndex('CREATE INDEX IF NOT EXISTS idx_voice_assets_status ON voice_assets(status)');

  // Web Push subscriptions (iPhone/desktop PWA push). One row per device/browser.
  _db!.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint    TEXT    UNIQUE NOT NULL,
      p256dh      TEXT    NOT NULL,
      auth        TEXT    NOT NULL,
      user_agent  TEXT,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now')),
      last_used_at TEXT
    )
  `);
  safeIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_endpoint ON push_subscriptions(endpoint)');

  // Seed tool families
  try {
    seedFamilies();
  } catch { /* seeding is best-effort; ignore failures during build/init */ }

  // Seed thumbnail styles + backfill usage from YouTube-published history
  try {
    seedThumbnailStyles();
    reconcileStyleUsage(); // idempotent: backfills counts + auto-retires styles used >=2x
  } catch { /* seeding is best-effort; ignore failures during build/init */ }

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
  seedSetting('usd_to_twd', '31.0');
  seedSetting('voai_cost_per_char_twd', '0.006');
  seedSetting('kieai_gpt_image_2_1k_usd', '0.03');
  seedSetting('kieai_kling_i2v_usd', '0.55');
  seedSetting('kieai_nano_banana_edit_usd', '0.04');
  seedSetting('falai_gpt_image_2_high_usd', '0.08');

  // Social trend bot defaults
  seedSetting('trend_seed_keywords', JSON.stringify([
    'AI 應用', 'AI 導入', 'vibe coding', 'Claude Code', 'AI Agent', 'AI 工具',
    '職場', '外商求職', '遠端工作', '科技業', '英國',
  ]));                                       // targeted topics to also search — derived from Tommy's 👍 (AI 實作 + 職涯/求職)
  seedSetting('trend_recency_days', '2');    // drop posts older than this (kills stale evergreen)
  seedSetting('trend_draft_count', '5');     // how many top posts to generate 蹭點 drafts for
  seedSetting('trend_min_engagement', '80');    // keep posts with 讚+留言 ≥ this (flat, AI too)
  seedSetting('trend_scrape_times', '10:00,21:00'); // 2x/day auto-scan times (HH:MM, comma-separated)
  seedSetting('trend_topics_per_scan', '5');  // topic rotation: # of seed topics searched per scan
  seedSetting('trend_jitter_minutes', '25');  // schedule jitter window in minutes (anti-detection)
  seedSetting('trend_min_interest', '0.3');  // hard filter: only show posts with interest_score ≥ this

  // Web Push: which events actually buzz your iPhone (治「太雜」— published 預設關掉當 FYI)
  seedSetting('push_event_filter', JSON.stringify([
    'episode.ready_for_review',
    'pipeline.failed',
    'pipeline.retry.failed',
    'episode.publish.partial_failure',
    'boss.brief',
    'trends.reply_zone.new',   // 回覆專區有新貼文
    'resources.new',           // 學習資源掃到高分新資源
  ]));
  // Merge newly-added push keys into existing DBs (seed above is INSERT OR IGNORE only).
  try {
    const existing = _db!.prepare("SELECT value FROM settings WHERE key = 'push_event_filter'").get() as { value?: string } | undefined;
    if (existing?.value) {
      const arr = JSON.parse(existing.value) as string[];
      let changed = false;
      for (const k of ['trends.reply_zone.new', 'resources.new']) {
        if (!arr.includes(k)) { arr.push(k); changed = true; }
      }
      if (changed) _db!.prepare("UPDATE settings SET value = ? WHERE key = 'push_event_filter'").run(JSON.stringify(arr));
    }
  } catch { /* setting malformed — leave as-is */ }

  // Current AI model versions reference (kept fresh via modelVersionRegistry web refresh).
  // Inlined here (not imported) to avoid a circular import with the registry service.
  seedSetting('current_model_versions', JSON.stringify([
    { name: 'Claude', latest: 'Opus 4.8 / Sonnet 4.6 / Haiku 4.5 (Fable 5)', asOf: '2026-06-15' },
    { name: 'GPT (OpenAI)', latest: 'GPT-5.5', asOf: '2026-06-15' },
    { name: 'Gemini (Google)', latest: 'Gemini 3.1', asOf: '2026-06-15' },
  ]));

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

  // Migrate: link existing sponsor_audio_presets to ad_presets by name
  try {
    const unlinked = _db!.prepare(
      'SELECT id, name FROM sponsor_audio_presets WHERE ad_preset_id IS NULL'
    ).all() as { id: number; name: string }[];
    for (const sp of unlinked) {
      const match = _db!.prepare(
        'SELECT id FROM ad_presets WHERE name = ?'
      ).get(sp.name) as { id: number } | undefined;
      if (match) {
        _db!.prepare('UPDATE sponsor_audio_presets SET ad_preset_id = ? WHERE id = ?').run(match.id, sp.id);
      } else {
        const result = _db!.prepare('INSERT INTO ad_presets (name, content) VALUES (?, ?)').run(sp.name, '');
        _db!.prepare('UPDATE sponsor_audio_presets SET ad_preset_id = ? WHERE id = ?').run(result.lastInsertRowid, sp.id);
      }
    }
  } catch { /* migration already done or table not ready */ }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
