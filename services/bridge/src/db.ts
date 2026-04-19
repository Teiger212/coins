import { Database } from "bun:sqlite";

let cached: Database | null = null;

export function getDb(path: string): Database {
  if (cached) return cached;
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  cached = db;
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_events (
      transaction_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      email TEXT NOT NULL,
      course_uuid TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      payload_json TEXT NOT NULL,
      result_json TEXT
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      course_uuid TEXT NOT NULL,
      transaction_id TEXT,
      enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      UNIQUE(user_id, course_uuid)
    );

    CREATE INDEX IF NOT EXISTS idx_enrollments_email ON enrollments(email);
    CREATE INDEX IF NOT EXISTS idx_enrollments_expires ON enrollments(expires_at) WHERE revoked_at IS NULL;
  `);
}

export interface ProcessedEvent {
  transaction_id: string;
  event_type: string;
  email: string;
  course_uuid: string | null;
  received_at: string;
  payload_json: string;
  result_json: string | null;
}

export function findProcessedEvent(
  db: Database,
  transactionId: string,
): ProcessedEvent | null {
  return (
    (db
      .query("SELECT * FROM processed_events WHERE transaction_id = ?")
      .get(transactionId) as ProcessedEvent | null) ?? null
  );
}

export function recordProcessedEvent(
  db: Database,
  row: {
    transaction_id: string;
    event_type: string;
    email: string;
    course_uuid: string | null;
    payload_json: string;
    result_json: string | null;
  },
): void {
  db.query(
    `INSERT OR REPLACE INTO processed_events
      (transaction_id, event_type, email, course_uuid, payload_json, result_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    row.transaction_id,
    row.event_type,
    row.email,
    row.course_uuid,
    row.payload_json,
    row.result_json,
  );
}

export function recordEnrollment(
  db: Database,
  row: {
    user_id: number;
    email: string;
    course_uuid: string;
    transaction_id: string | null;
    expires_at: string;
  },
): void {
  db.query(
    `INSERT INTO enrollments (user_id, email, course_uuid, transaction_id, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_uuid) DO UPDATE SET
       expires_at = excluded.expires_at,
       transaction_id = excluded.transaction_id,
       revoked_at = NULL`,
  ).run(
    row.user_id,
    row.email,
    row.course_uuid,
    row.transaction_id,
    row.expires_at,
  );
}

export function revokeEnrollment(
  db: Database,
  args: { user_id: number; course_uuid: string },
): void {
  db.query(
    `UPDATE enrollments
     SET revoked_at = datetime('now')
     WHERE user_id = ? AND course_uuid = ? AND revoked_at IS NULL`,
  ).run(args.user_id, args.course_uuid);
}
