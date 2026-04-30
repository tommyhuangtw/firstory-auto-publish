-- AI Podcast Automation Platform — SQLite Schema
-- Source of truth for episodes, tools memory, LLM tracking, and analytics

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER UNIQUE,
  segment_type TEXT NOT NULL,        -- 'daily' | 'weekly' | 'robot'
  status TEXT NOT NULL DEFAULT 'generating',
  -- Status flow: generating → pending_review → approved → publishing → published | rejected

  -- Content
  script_en TEXT,
  script_zh TEXT,
  candidate_titles TEXT,              -- JSON array of 10 titles
  selected_title TEXT,
  description TEXT,
  tags TEXT,                          -- JSON array

  -- Media
  audio_path TEXT,
  cover_path TEXT,

  -- Source videos
  source_videos TEXT,                 -- JSON: [{videoId, title, views, ...}]

  -- Summary (condensed script for meta generation)
  script_summary TEXT,

  -- Quality & Cost
  quality_score REAL,
  total_cost_usd REAL,
  script_word_count INTEGER,

  -- Publish results
  soundon_url TEXT,
  youtube_url TEXT,
  ig_caption TEXT,
  ig_post_id TEXT,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')),
  approved_at TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS tool_families (
  id INTEGER PRIMARY KEY,
  family_name TEXT UNIQUE NOT NULL,     -- "Claude", "ChatGPT", "Gemini"
  pattern TEXT NOT NULL,                -- regex for matching variants
  canonical_display TEXT NOT NULL,      -- "Claude (Anthropic)" for UI
  category TEXT                         -- default category for family members
);

CREATE TABLE IF NOT EXISTS tools (
  id INTEGER PRIMARY KEY,
  canonical_name TEXT UNIQUE NOT NULL,
  aliases TEXT,                       -- JSON array
  category TEXT,                      -- 'LLM' | 'DevTool' | 'Image' | 'Audio' | ...
  first_episode INTEGER,              -- stores episodes.id (not episode_number)
  latest_episode INTEGER,
  mention_count INTEGER DEFAULT 0,
  evolving_summary TEXT,              -- legacy, kept for migration
  current_summary TEXT,               -- LLM-compressed ≤300 chars, replaces evolving_summary
  summary_version INTEGER DEFAULT 0,  -- increments on each compaction
  latest_version_detail TEXT,         -- "Opus 4.6", "4o", "3.5 Sonnet"
  family_id INTEGER REFERENCES tool_families(id),
  first_seen_date TEXT,               -- "2026-04-20" — date-based tracking for memory UI
  latest_seen_date TEXT               -- "2026-04-25"
);

CREATE TABLE IF NOT EXISTS episode_tool_mentions (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER NOT NULL,
  tool_id INTEGER REFERENCES tools(id),
  mention_type TEXT,                  -- 'new' | 'update' | 'deep_dive' | 'brief'
  context_snippet TEXT,
  significance REAL DEFAULT 0.5,     -- 0.0-1.0 importance score
  version_detail TEXT,               -- specific version mentioned this episode
  aired_date TEXT,                   -- "2026-04-20" — date of the episode
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  stage TEXT NOT NULL,                -- 'classify' | 'script_en' | 'script_zh' | 'scoring' | 'title_gen'
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  quality_score REAL,
  success INTEGER DEFAULT 1,
  error_message TEXT,
  input_messages TEXT,              -- JSON: [{role, content}] full prompt
  output_content TEXT,              -- LLM response full text
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  segment_type TEXT,
  status TEXT,                        -- 'running' | 'completed' | 'failed' | 'paused'
  current_stage TEXT,
  checkpoint_data TEXT,               -- JSON: LangGraph checkpoint
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  error_log TEXT
);

CREATE TABLE IF NOT EXISTS youtube_sources (
  id INTEGER PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  title TEXT,
  channel_name TEXT,
  published_at TEXT,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  duration_seconds INTEGER,
  transcript TEXT,
  classification TEXT,                -- 'is_tool' | 'not_tool' | 'is_robotics'
  used_in_episode INTEGER,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS robot_youtube_sources (
  id INTEGER PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  title TEXT,
  channel_name TEXT,
  published_at TEXT,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  duration_seconds INTEGER,
  transcript TEXT,
  classification TEXT,                -- 'is_robotics' | 'non_robotics'
  used_in_episode INTEGER,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_youtube_sources (
  id INTEGER PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  title TEXT,
  channel_name TEXT,
  published_at TEXT,
  view_count INTEGER,
  like_count INTEGER,
  comment_count INTEGER,
  duration_seconds INTEGER,
  transcript TEXT,
  classification TEXT,                -- 'is_tool' | 'not_tool'
  used_in_episode INTEGER,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS platform_analytics (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  platform TEXT,                      -- 'youtube' | 'soundon' | 'spotify' | 'apple'
  date TEXT,
  views INTEGER,
  listens INTEGER,
  likes INTEGER,
  comments INTEGER,
  avg_listen_duration_sec INTEGER,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  output_data TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  elapsed_ms INTEGER,
  FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ad_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shorts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_number INTEGER,             -- nullable; episode_id is the primary reference
  status TEXT NOT NULL DEFAULT 'pending',
  -- Status: pending → beats_ready → headline_ready → generating → completed → published | failed

  -- User selections
  avatar_filename TEXT,             -- sloth_studio_V10-cozy.png
  beats_json TEXT,                  -- JSON: [{text, reason}]
  selected_beat_index INTEGER,
  headlines_json TEXT,              -- JSON: ["headline1", ...]
  selected_headline_index INTEGER,

  -- Output
  video_path TEXT,                  -- remotion/out/short_xxx.mp4
  cover_path TEXT,                  -- remotion/out/cover_xxx.png
  manifest_json TEXT,

  -- IG
  ig_caption TEXT,
  ig_post_id TEXT,

  -- Progress
  current_stage TEXT,
  error_log TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS service_costs (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  shorts_id INTEGER,              -- NULL for podcast, shorts.id for shorts
  service TEXT NOT NULL,           -- 'voai_tts' | 'kieai_cover' | 'kieai_veo3' | 'kieai_kling' | 'kieai_edit'
  model TEXT,                     -- 'neo' | 'nano-banana-pro' | 'veo3_fast' etc.
  units INTEGER,                  -- char count for TTS, 1 for images/videos
  cost_usd REAL,
  latency_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS soundon_daily_downloads (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  downloads INTEGER NOT NULL,
  unique_downloads INTEGER NOT NULL,
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date)
);

CREATE TABLE IF NOT EXISTS soundon_episodes (
  id INTEGER PRIMARY KEY,
  episode_number INTEGER,
  title TEXT NOT NULL,
  publish_type TEXT,                     -- 'public'
  total_downloads INTEGER,
  downloads_7d INTEGER,
  downloads_30d INTEGER,
  duration_sec REAL,
  published_at TEXT,
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(title)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
CREATE INDEX IF NOT EXISTS idx_episodes_segment ON episodes(segment_type);
CREATE INDEX IF NOT EXISTS idx_llm_calls_episode ON llm_calls(episode_number);
CREATE INDEX IF NOT EXISTS idx_llm_calls_stage ON llm_calls(stage);
CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(canonical_name);
-- idx_tools_family and idx_mentions_significance created in index.ts after safe ALTER
CREATE INDEX IF NOT EXISTS idx_youtube_sources_video ON youtube_sources(video_id);
CREATE INDEX IF NOT EXISTS idx_analytics_episode ON platform_analytics(episode_number);
CREATE INDEX IF NOT EXISTS idx_snapshots_run ON pipeline_snapshots(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_robot_youtube_sources_video ON robot_youtube_sources(video_id);
CREATE INDEX IF NOT EXISTS idx_weekly_youtube_sources_video ON weekly_youtube_sources(video_id);
CREATE INDEX IF NOT EXISTS idx_shorts_episode ON shorts(episode_number);
CREATE INDEX IF NOT EXISTS idx_service_costs_episode ON service_costs(episode_number);
CREATE INDEX IF NOT EXISTS idx_service_costs_shorts ON service_costs(shorts_id);
CREATE INDEX IF NOT EXISTS idx_soundon_daily_date ON soundon_daily_downloads(date);
CREATE INDEX IF NOT EXISTS idx_soundon_episodes_number ON soundon_episodes(episode_number);
