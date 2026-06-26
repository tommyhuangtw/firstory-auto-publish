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
  original_audio_path TEXT,            -- preserved on first manual audio replacement
  audio_duration_sec REAL,
  cover_path TEXT,

  -- Source videos
  source_videos TEXT,                 -- JSON: [{videoId, title, views, ...}]

  -- Summary (condensed script for meta generation)
  script_summary TEXT,

  -- Quality & Cost
  quality_score REAL,
  total_cost_usd REAL,
  script_word_count INTEGER,

  -- Subtitles
  srt_path TEXT,                    -- file path to generated .srt file
  srt_content TEXT,                 -- full SRT text (for preview & upload)

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

-- Substack draft per episode (one-click "share to Substack" feature)
CREATE TABLE IF NOT EXISTS substack_drafts (
  id INTEGER PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  seo_title TEXT,                          -- SEO title (keyword + benefit)
  deck TEXT,                               -- subtitle / thesis preview
  seo_description TEXT,                     -- meta description
  cover_image_url TEXT,                     -- left empty in v1 (manual Canva cover)
  body_markdown TEXT,                       -- article body (Markdown)
  images_json TEXT,                         -- JSON: [{query,index,url,alt,photographer,photographerUrl,photoUrl}] for "換一張"
  audio_url TEXT,                           -- podcast link for the CTA
  status TEXT NOT NULL DEFAULT 'draft',     -- 'draft' | 'published' (manual flag)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_substack_drafts_episode ON substack_drafts(episode_id);

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

CREATE TABLE IF NOT EXISTS sponsor_audio_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  script_text TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  audio_duration_sec REAL,
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

-- Episode digests: compiled summary of each episode for cross-episode memory
CREATE TABLE IF NOT EXISTS episode_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  segment_type TEXT NOT NULL,
  thesis TEXT NOT NULL,                 -- 1-2 sentence core argument
  key_insights TEXT NOT NULL,           -- JSON array of insight strings
  tools_covered TEXT NOT NULL,          -- JSON array of tool names
  open_threads TEXT NOT NULL,           -- JSON array: unresolved questions/trends
  digest_text TEXT NOT NULL,            -- full compiled digest (~200-400 chars)
  aired_date TEXT NOT NULL,
  is_milestone INTEGER DEFAULT 0,      -- 1 = major event, survives temporal decay
  milestone_label TEXT,                 -- e.g., "Claude Code launched"
  created_at TEXT DEFAULT (datetime('now'))
);

-- Theme tracker: recurring themes with LSM-compacted summaries
CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_name TEXT UNIQUE NOT NULL,
  category TEXT,                        -- e.g., "AI Coding", "Robotics", "LLM Models"
  current_summary TEXT,                 -- <=500 chars, LSM-compacted
  summary_version INTEGER DEFAULT 1,
  episode_count INTEGER DEFAULT 1,
  first_episode_id INTEGER,
  latest_episode_id INTEGER,
  first_seen_date TEXT,
  latest_seen_date TEXT,
  is_evergreen INTEGER DEFAULT 0        -- 1 = major trend, survives temporal decay
);

-- Junction: which themes appear in which episodes
CREATE TABLE IF NOT EXISTS episode_themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  theme_id INTEGER NOT NULL REFERENCES themes(id),
  relevance REAL DEFAULT 0.5,           -- 0.0-1.0
  context_snippet TEXT,                 -- how this episode relates to the theme
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(episode_id, theme_id)
);

-- Thumbnail style management: DB-backed style pool for YouTube thumbnails
CREATE TABLE IF NOT EXISTS thumbnail_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,              -- kebab-case slug: 'clean-white', 'dark-glow'
  bg TEXT NOT NULL,                       -- background prompt fragment
  text_style TEXT NOT NULL,               -- text styling prompt fragment
  layout TEXT NOT NULL,                   -- layout prompt fragment
  is_enabled INTEGER DEFAULT 1,           -- 1 = in the active random pool
  source TEXT DEFAULT 'seed',             -- 'seed' | 'generated'
  sample_image_url TEXT,                  -- audition sample serve URL
  sample_hook_title TEXT,                 -- hook title used for the sample
  generated_at TEXT,                      -- when AI generated this style
  usage_count INTEGER DEFAULT 0,          -- # of YouTube-published episodes using this style (>=2 auto-retired)
  created_at TEXT DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_digests_episode ON episode_digests(episode_id);
CREATE INDEX IF NOT EXISTS idx_digests_segment_date ON episode_digests(segment_type, aired_date);
CREATE INDEX IF NOT EXISTS idx_digests_milestone ON episode_digests(is_milestone);
CREATE INDEX IF NOT EXISTS idx_themes_name ON themes(theme_name);
CREATE INDEX IF NOT EXISTS idx_episode_themes_episode ON episode_themes(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_themes_theme ON episode_themes(theme_id);

-- ── Tasks (Kanban / Project Management) ─────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',      -- todo | in_progress | done | cancelled
  priority TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high | urgent
  category TEXT NOT NULL DEFAULT 'ops',
  -- category: content | infra | social_media | youtube | ig | threads | research | ops | growth

  -- Scheduling & automation
  scheduled_at TEXT,          -- ISO datetime; if set, auto-check at this time
  auto_execute INTEGER DEFAULT 0,  -- 1 = I run it automatically (research/data tasks only)

  -- Linkage
  episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL,

  -- Execution
  result_notes TEXT,          -- what I did / found after completing
  created_by TEXT DEFAULT 'telegram',  -- telegram | system | manual

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

-- ── Knowledge Base (Research Document Index) ─────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_docs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT    UNIQUE NOT NULL,
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'research',
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  word_count  INTEGER,
  created_at  TEXT    DEFAULT (datetime('now')),
  indexed_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_category ON knowledge_docs(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_task ON knowledge_docs(task_id);

-- ── Content Summaries (Task #10: Podcast & YouTube content summarization) ─────
CREATE TABLE IF NOT EXISTS content_summaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL,
  source_type TEXT    NOT NULL,           -- 'youtube' | 'podcast_rss' | 'podcast_episode'
  title       TEXT,
  channel_name TEXT,                      -- channel or podcast name
  thumbnail_url TEXT,
  transcript  TEXT,                       -- raw transcript/description text
  summary_json TEXT,                      -- JSON: structured AI analysis result
  status      TEXT    NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'completed' | 'failed'
  error_message TEXT,
  cost_usd    REAL    DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_summaries_status ON content_summaries(status);
CREATE INDEX IF NOT EXISTS idx_content_summaries_type ON content_summaries(source_type);

-- ── Multi-Agent System ──────────────────────────────────────────────

-- Agent discussions: conversation log between agents within a session
CREATE TABLE IF NOT EXISTS agent_discussions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER REFERENCES tasks(id),
  session_id    TEXT    NOT NULL,           -- groups messages in same orchestrator run
  agent_id      TEXT    NOT NULL,           -- 'pm' | 'planner' | 'engineer'
  agent_name    TEXT    NOT NULL,           -- '懶懶' | '小企' | '小工'
  message_type  TEXT    NOT NULL,           -- 'proposal' | 'review' | 'decision' | 'execution' | 'report'
  content       TEXT    NOT NULL,
  token_usage   INTEGER,
  duration_ms   INTEGER,
  created_at    TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_disc_session ON agent_discussions(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_disc_task ON agent_discussions(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_disc_agent ON agent_discussions(agent_id);

-- Agent proposals: any agent can propose ideas for PM to evaluate
CREATE TABLE IF NOT EXISTS agent_proposals (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT    NOT NULL,
  proposed_by         TEXT    NOT NULL,     -- 'planner' | 'engineer' | 'pm'
  proposal_type       TEXT    NOT NULL,     -- 'feature' | 'optimization' | 'research' | 'bugfix' | 'content'
  title               TEXT    NOT NULL,
  description         TEXT    NOT NULL,
  priority_suggestion TEXT,                 -- proposer's suggested priority
  pm_decision         TEXT,                 -- 'approved' | 'rejected' | 'needs_tommy' | 'deferred'
  pm_reasoning        TEXT,                 -- PM's decision rationale
  task_id             INTEGER,              -- created task ID if approved
  created_at          TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_prop_decision ON agent_proposals(pm_decision);
CREATE INDEX IF NOT EXISTS idx_agent_prop_by ON agent_proposals(proposed_by);

-- Alerts: notifications requiring Tommy's attention (Dashboard + Telegram)
CREATE TABLE IF NOT EXISTS alerts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source_agent        TEXT    NOT NULL,     -- 'pm' | 'planner' | 'engineer'
  alert_type          TEXT    NOT NULL,     -- 'needs_decision' | 'review_ready' | 'proposal' | 'error' | 'daily_summary'
  title               TEXT    NOT NULL,
  description         TEXT    NOT NULL,
  urgency             TEXT    NOT NULL DEFAULT 'normal',  -- 'low' | 'normal' | 'high' | 'urgent'
  status              TEXT    NOT NULL DEFAULT 'unread',  -- 'unread' | 'read' | 'actioned' | 'dismissed'
  related_task_id     INTEGER,
  related_proposal_id INTEGER,
  telegram_sent       INTEGER DEFAULT 0,
  created_at          TEXT    DEFAULT (datetime('now')),
  actioned_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_urgency ON alerts(urgency);
CREATE INDEX IF NOT EXISTS idx_alerts_agent ON alerts(source_agent);

-- Agent memory: per-agent persistent knowledge with LSM-tree compaction
CREATE TABLE IF NOT EXISTS agent_memory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT    NOT NULL,         -- 'pm' | 'planner' | 'engineer'
  memory_type     TEXT    NOT NULL,         -- 'lesson' | 'preference' | 'pattern' | 'context'
  topic           TEXT    NOT NULL,         -- memory key for merge
  current_summary TEXT    NOT NULL,         -- ≤500 chars, LSM-compacted
  summary_version INTEGER DEFAULT 1,
  last_updated    TEXT    DEFAULT (datetime('now')),
  UNIQUE(agent_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_agent_mem_agent ON agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_mem_updated ON agent_memory(last_updated);
