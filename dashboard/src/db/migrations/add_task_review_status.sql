-- Add completed_by to tasks: 'hermes' | 'manual'
-- SQLite doesn't support ALTER COLUMN, so we add a new column
ALTER TABLE tasks ADD COLUMN completed_by TEXT DEFAULT NULL;

-- completed_at already exists (added in original schema)
-- status enum is enforced at app layer, not DB layer in SQLite
-- so 'review' is just a new valid string value
