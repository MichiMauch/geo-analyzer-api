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
  extensionVersion: string;
}

export function initDb(): void {
  // Ensure data directory exists
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
      extension_version TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analyses_url ON analyses(url);
    CREATE INDEX IF NOT EXISTS idx_analyses_timestamp ON analyses(timestamp);
  `);
}

export function insertAnalysis(row: AnalysisRow): void {
  const stmt = db.prepare(`
    INSERT INTO analyses (url, timestamp, total_score, content_clarity, answerability, trust_sources, machine_readability, extension_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    row.url,
    row.timestamp,
    row.totalScore,
    row.contentClarity,
    row.answerability,
    row.trustSources,
    row.machineReadability,
    row.extensionVersion,
  );
}

export function getAllAnalyses(limit: number) {
  return db.prepare('SELECT * FROM analyses ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function getAnalysesByUrl(url: string, limit: number) {
  return db.prepare('SELECT * FROM analyses WHERE url = ? ORDER BY timestamp DESC LIMIT ?').all(url, limit);
}
