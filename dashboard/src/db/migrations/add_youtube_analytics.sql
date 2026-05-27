-- YouTube Analytics tables
-- Channel-level daily snapshots (aggregate from Data API)
CREATE TABLE IF NOT EXISTS youtube_channel_stats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date   TEXT    NOT NULL,
  subscriber_count INTEGER DEFAULT 0,
  view_count      INTEGER DEFAULT 0,
  video_count     INTEGER DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_yt_channel_date ON youtube_channel_stats(snapshot_date);

-- Per-video stats (snapshot each time we fetch)
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
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_yt_video_composite ON youtube_video_stats(video_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_yt_video_date ON youtube_video_stats(snapshot_date);
