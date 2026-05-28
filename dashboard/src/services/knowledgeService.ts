import fs from 'fs';
import path from 'path';
import { getDb } from '@/db';

const RESEARCH_DIR = path.join(process.cwd(), 'data', 'research');

export interface KnowledgeDoc {
  id: number;
  filename: string;
  title: string;
  category: string;
  task_id: number | null;
  word_count: number | null;
  created_at: string;
  indexed_at: string;
  // Joined from tasks table
  task_title?: string;
  task_status?: string;
}

/**
 * Scan data/research/ and index any new .md files into knowledge_docs.
 * Derives category from the linked task's category field.
 */
export function syncResearchFiles(): void {
  const db = getDb();
  if (!fs.existsSync(RESEARCH_DIR)) return;

  const files = fs.readdirSync(RESEARCH_DIR).filter(f => f.endsWith('.md'));
  const indexed = new Set(
    (db.prepare('SELECT filename FROM knowledge_docs').all() as { filename: string }[])
      .map(r => r.filename)
  );

  for (const filename of files) {
    if (indexed.has(filename)) continue;

    // Extract task ID from filename pattern: task-{id}-{slug}.md
    const taskMatch = filename.match(/^task-(\d+)-/);
    const taskId = taskMatch ? parseInt(taskMatch[1]) : null;

    let title = filename.replace(/\.md$/, '').replace(/^task-\d+-/, '').replace(/-/g, ' ');
    let category = 'research';

    if (taskId) {
      const task = db.prepare('SELECT title, category FROM tasks WHERE id = ?').get(taskId) as
        { title: string; category: string } | undefined;
      if (task) {
        title = task.title;
        category = task.category;
      }
    }

    // Extract first H1 as title fallback for non-task files
    const content = fs.readFileSync(path.join(RESEARCH_DIR, filename), 'utf-8');
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match && !taskId) {
      title = h1Match[1];
    }

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    // Use file mtime as created_at
    const stat = fs.statSync(path.join(RESEARCH_DIR, filename));
    const createdAt = stat.mtime.toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(
      'INSERT OR IGNORE INTO knowledge_docs (filename, title, category, task_id, word_count, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(filename, title, category, taskId, wordCount, createdAt);
  }
}

export function getAllDocs(options?: {
  search?: string;
  category?: string;
  limit?: number;
}): KnowledgeDoc[] {
  const db = getDb();
  syncResearchFiles();

  const { search, category, limit = 100 } = options || {};
  let query = `
    SELECT kd.*, t.title as task_title, t.status as task_status
    FROM knowledge_docs kd
    LEFT JOIN tasks t ON t.id = kd.task_id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (search) {
    query += ' AND (kd.title LIKE ? OR kd.filename LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    query += ' AND kd.category = ?';
    params.push(category);
  }

  query += ' ORDER BY kd.created_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params) as KnowledgeDoc[];
}

export function getDocByFilename(filename: string): KnowledgeDoc | undefined {
  const db = getDb();
  syncResearchFiles();
  return db.prepare(`
    SELECT kd.*, t.title as task_title, t.status as task_status
    FROM knowledge_docs kd
    LEFT JOIN tasks t ON t.id = kd.task_id
    WHERE kd.filename = ?
  `).get(filename) as KnowledgeDoc | undefined;
}

export function getDocCategories(): string[] {
  const db = getDb();
  return (db.prepare(
    'SELECT DISTINCT category FROM knowledge_docs ORDER BY category'
  ).all() as { category: string }[]).map(r => r.category);
}

/**
 * Read the raw markdown content of a research file.
 */
export function getDocContent(filename: string): string | null {
  const filePath = path.join(RESEARCH_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}
