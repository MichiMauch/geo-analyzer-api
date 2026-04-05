import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'analyses.db');

let db: Database.Database;

export interface AnalysisRow {
  url: string;
  timestamp: string;
  totalScore: number;
  contentClarity: number;
  answerability: number;
  trustSources: number;
  machineReadability: number;
  aiCitation: number;
  extensionVersion: string;
}

export function initDb(): void {
  const dir = path.dirname(DB_PATH);
  mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      total_score REAL NOT NULL,
      content_clarity REAL NOT NULL,
      answerability REAL NOT NULL,
      trust_sources REAL NOT NULL,
      machine_readability REAL NOT NULL,
      ai_citation REAL NOT NULL DEFAULT 0,
      extension_version TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add ai_citation column if missing (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE analyses ADD COLUMN ai_citation REAL NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analyses_url ON analyses(url);
    CREATE INDEX IF NOT EXISTS idx_analyses_timestamp ON analyses(timestamp);
    CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at);
  `);
}

export function insertAnalysis(row: AnalysisRow): void {
  const stmt = db.prepare(`
    INSERT INTO analyses (url, timestamp, total_score, content_clarity, answerability, trust_sources, machine_readability, ai_citation, extension_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    row.url,
    row.timestamp,
    row.totalScore,
    row.contentClarity,
    row.answerability,
    row.trustSources,
    row.machineReadability,
    row.aiCitation,
    row.extensionVersion,
  );
}

export function findRecentDuplicate(url: string, totalScore: number, sinceIso: string): boolean {
  const stmt = db.prepare(`
    SELECT 1 FROM analyses
    WHERE url = ? AND total_score = ? AND created_at > ?
    LIMIT 1
  `);
  return stmt.get(url, totalScore, sinceIso) !== undefined;
}

export function getAllAnalyses(limit: number) {
  return db.prepare('SELECT * FROM analyses ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function getAnalysesByUrl(url: string, limit: number) {
  return db.prepare('SELECT * FROM analyses WHERE url = ? ORDER BY timestamp DESC LIMIT ?').all(url, limit);
}
