#!/usr/bin/env bun
/**
 * Unenrolls learners whose 12-month access window has expired.
 *
 * Runs idempotently — iterates enrollments where `expires_at < now()` and
 * `revoked_at IS NULL`, calls LH's DELETE /enrollments/{user}/{course},
 * then marks the row revoked so we don't re-call. Safe to cron daily.
 *
 * Usage: bun run scripts/reap-expired.ts [--dry-run]
 */
import { loadEnv } from "../src/env.ts";
import { LearnhouseClient } from "../src/clients/learnhouse.ts";
import { getDb } from "../src/db.ts";

interface ExpiredRow {
  id: number;
  user_id: number;
  email: string;
  course_uuid: string;
  expires_at: string;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = loadEnv();
  if (!env.LH_ADMIN_TOKEN) {
    console.error("LH_ADMIN_TOKEN is required");
    process.exit(2);
  }

  const db = getDb(env.SQLITE_PATH);
  const rows = db
    .query(
      `SELECT id, user_id, email, course_uuid, expires_at
       FROM enrollments
       WHERE revoked_at IS NULL AND expires_at < datetime('now')
       ORDER BY expires_at ASC`,
    )
    .all() as ExpiredRow[];

  if (rows.length === 0) {
    console.log("no expired enrollments to reap");
    return;
  }

  console.log(`found ${rows.length} expired enrollment(s)${dryRun ? " (dry run)" : ""}`);

  if (dryRun) {
    for (const r of rows) console.log(`  ${r.email}  course=${r.course_uuid}  expired=${r.expires_at}`);
    return;
  }

  const lh = new LearnhouseClient({
    baseUrl: env.LH_BASE_URL,
    orgSlug: env.LH_ORG_SLUG,
    adminToken: env.LH_ADMIN_TOKEN,
  });

  let revoked = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await lh.unenrollUser({ userId: r.user_id, courseUuid: r.course_uuid });
      db.query(`UPDATE enrollments SET revoked_at = datetime('now') WHERE id = ?`).run(r.id);
      revoked++;
      console.log(`revoked  ${r.email}  course=${r.course_uuid}`);
    } catch (err) {
      failed++;
      console.error(`FAILED   ${r.email}  course=${r.course_uuid}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`done. revoked=${revoked} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main();
