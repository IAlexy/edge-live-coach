import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export interface SessionRecord {
  id: string;
  created_at: string;
  exercise: string;
  total_reps: number;
  avg_global_score: number;
  avg_stability: number;
  avg_tempo: number;
  avg_depth: number;
  avg_posture: number;
}

export interface RepScoreRecord {
  id: string;
  session_id: string;
  rep_number: number;
  global_score: number;
  stability_score: number;
  tempo_score: number;
  depth_score: number;
  posture_score: number;
  duration_sec: number;
  created_at: string;
}

export interface AnomalyLogRecord {
  id: string;
  session_id: string;
  rep_number: number;
  anomaly_type: string;
  severity: string;
  generated_prompt: string;
  llm_response: string;
  latency_ms: number;
  created_at: string;
}

interface SessionAveragesRow {
  count: number;
  avg_global: number | null;
  avg_stability: number | null;
  avg_tempo: number | null;
  avg_depth: number | null;
  avg_posture: number | null;
}

const resolvedDbPath =
  process.env.DB_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(process.cwd(), process.env.DB_PATH || 'data/coaching_progression.db');

if (resolvedDbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
}

export const db = new DatabaseSync(resolvedDbPath);

// Initialisation du schéma SQLite
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    exercise TEXT NOT NULL,
    total_reps INTEGER DEFAULT 0,
    avg_global_score REAL DEFAULT 0,
    avg_stability REAL DEFAULT 0,
    avg_tempo REAL DEFAULT 0,
    avg_depth REAL DEFAULT 0,
    avg_posture REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rep_scores (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    rep_number INTEGER NOT NULL,
    global_score REAL NOT NULL,
    stability_score REAL NOT NULL,
    tempo_score REAL NOT NULL,
    depth_score REAL NOT NULL,
    posture_score REAL NOT NULL,
    duration_sec REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS anomalies_log (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    rep_number INTEGER NOT NULL,
    anomaly_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    generated_prompt TEXT NOT NULL,
    llm_response TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

/**
 * Crée ou met à jour une session d'entraînement.
 */
export function upsertSession(session: SessionRecord): void {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, created_at, exercise, total_reps, avg_global_score, avg_stability, avg_tempo, avg_depth, avg_posture)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      total_reps = excluded.total_reps,
      avg_global_score = excluded.avg_global_score,
      avg_stability = excluded.avg_stability,
      avg_tempo = excluded.avg_tempo,
      avg_depth = excluded.avg_depth,
      avg_posture = excluded.avg_posture
  `);
  stmt.run(
    session.id,
    session.created_at,
    session.exercise,
    session.total_reps,
    session.avg_global_score,
    session.avg_stability,
    session.avg_tempo,
    session.avg_depth,
    session.avg_posture
  );
}

/**
 * Enregistre le score multi-facteurs d'une répétition.
 */
export function insertRepScore(record: RepScoreRecord): void {
  const stmt = db.prepare(`
    INSERT INTO rep_scores (id, session_id, rep_number, global_score, stability_score, tempo_score, depth_score, posture_score, duration_sec, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      global_score = excluded.global_score,
      stability_score = excluded.stability_score,
      tempo_score = excluded.tempo_score,
      depth_score = excluded.depth_score,
      posture_score = excluded.posture_score,
      duration_sec = excluded.duration_sec
  `);
  stmt.run(
    record.id,
    record.session_id,
    record.rep_number,
    record.global_score,
    record.stability_score,
    record.tempo_score,
    record.depth_score,
    record.posture_score,
    record.duration_sec,
    record.created_at
  );

  // Recalcule et met à jour les moyennes de la session
  updateSessionAverages(record.session_id);
}

function updateSessionAverages(sessionId: string): void {
  const row = db
    .prepare(`
      SELECT 
        COUNT(*) as count,
        AVG(global_score) as avg_global,
        AVG(stability_score) as avg_stability,
        AVG(tempo_score) as avg_tempo,
        AVG(depth_score) as avg_depth,
        AVG(posture_score) as avg_posture
      FROM rep_scores
      WHERE session_id = ?
    `)
    .get(sessionId) as unknown as SessionAveragesRow | undefined;

  if (row && row.count > 0) {
    db.prepare(`
      UPDATE sessions SET
        total_reps = ?,
        avg_global_score = ROUND(?, 1),
        avg_stability = ROUND(?, 1),
        avg_tempo = ROUND(?, 1),
        avg_depth = ROUND(?, 1),
        avg_posture = ROUND(?, 1)
      WHERE id = ?
    `).run(
      row.count,
      row.avg_global ?? 0,
      row.avg_stability ?? 0,
      row.avg_tempo ?? 0,
      row.avg_depth ?? 0,
      row.avg_posture ?? 0,
      sessionId
    );
  }
}

/**
 * Enregistre une interaction d'anomalie (Prompt textuel + Réponse)
 * STRICTEMENT CONFORME PRIVACY : Aucun enregistrement image ou son.
 */
export function insertAnomalyLog(record: AnomalyLogRecord): void {
  const stmt = db.prepare(`
    INSERT INTO anomalies_log (id, session_id, rep_number, anomaly_type, severity, generated_prompt, llm_response, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      llm_response = excluded.llm_response,
      latency_ms = excluded.latency_ms
  `);
  stmt.run(
    record.id,
    record.session_id,
    record.rep_number,
    record.anomaly_type,
    record.severity,
    record.generated_prompt,
    record.llm_response,
    record.latency_ms,
    record.created_at
  );
}

/**
 * Récupère l'historique des sessions pour visualiser la progression.
 */
export function getSessionHistory(limit = 10): SessionRecord[] {
  return db
    .prepare(`
      SELECT * FROM sessions
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit) as unknown as SessionRecord[];
}

/**
 * Récupère le détail de toutes les répétitions d'une session.
 */
export function getSessionReps(sessionId: string): RepScoreRecord[] {
  return db
    .prepare(`
      SELECT * FROM rep_scores
      WHERE session_id = ?
      ORDER BY rep_number ASC
    `)
    .all(sessionId) as unknown as RepScoreRecord[];
}

/**
 * Récupère les logs d'audit des anomalies récentes.
 */
export function getRecentAnomalies(limit = 20): AnomalyLogRecord[] {
  return db
    .prepare(`
      SELECT * FROM anomalies_log
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit) as unknown as AnomalyLogRecord[];
}

/**
 * Efface le journal d'audit des anomalies.
 */
export function clearAnomalyLogs(): void {
  db.prepare('DELETE FROM anomalies_log').run();
}

/**
 * Réinitialise toutes les tables (utile pour les tests).
 */
export function resetDatabase(): void {
  db.exec(`
    DELETE FROM anomalies_log;
    DELETE FROM rep_scores;
    DELETE FROM sessions;
  `);
}
