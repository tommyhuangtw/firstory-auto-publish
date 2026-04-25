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

  // Seed tool families
  try {
    const { seedFamilies } = require('@/services/memory/toolFamilies');
    seedFamilies();
  } catch { /* toolFamilies not available during build */ }

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
