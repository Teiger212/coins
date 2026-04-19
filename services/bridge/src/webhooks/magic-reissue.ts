import { Hono } from "hono";
import { z } from "zod";
import { loadEnv } from "../env.ts";
import { LearnhouseClient } from "../clients/learnhouse.ts";
import { ResendClient, magicLinkEmailHtml } from "../clients/resend.ts";
import { getDb } from "../db.ts";

/**
 * Public, unauthenticated endpoint for a learner to request a fresh magic
 * link after the previous one expired. Always returns 200 to avoid leaking
 * whether the email corresponds to an account.
 *
 * Abuse controls:
 *   - Rate-limited per email (max 3 requests per 10 minutes).
 *   - Only issues a link if SQLite shows an active (non-revoked, non-expired)
 *     enrollment for the email. This is intentionally stricter than "user
 *     exists" — the reissue is a learner feature, not an account-recovery one.
 */

export const magicReissueRoute = new Hono();

const Body = z.object({
  email: z.string().email().max(254),
});

// Reuse the processed_events table is overkill — use a dedicated tiny table.
function ensureRateLimitTable() {
  const env = loadEnv();
  const db = getDb(env.SQLITE_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_reissue_attempts (
      email TEXT NOT NULL,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (email, attempted_at)
    );
  `);
  return db;
}

magicReissueRoute.post("/magic-link/request", async (c) => {
  const env = loadEnv();
  if (!env.LH_ADMIN_TOKEN) {
    return c.json({ error: "service unavailable" }, 503);
  }

  const json = await c.req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    // Still opaque: don't disclose shape issues to clients beyond "ok".
    return c.json({ ok: true });
  }
  const email = parsed.data.email.toLowerCase();

  const db = ensureRateLimitTable();

  // Rate limit: max 3 in the last 10 minutes.
  const recent = (
    db
      .query(
        `SELECT COUNT(*) AS n FROM magic_reissue_attempts
         WHERE email = ? AND attempted_at > datetime('now', '-10 minutes')`,
      )
      .get(email) as { n: number } | null
  )?.n ?? 0;

  if (recent >= 3) {
    return c.json({ ok: true, rate_limited: true });
  }

  db.query(`INSERT INTO magic_reissue_attempts (email) VALUES (?)`).run(email);

  // Check enrollment record. Only issue a link when the learner has an active
  // (unrevoked, unexpired) enrollment we recorded at purchase time.
  const enrolled = db
    .query(
      `SELECT user_id, course_uuid FROM enrollments
       WHERE email = ? AND revoked_at IS NULL AND expires_at > datetime('now')
       ORDER BY enrolled_at DESC
       LIMIT 1`,
    )
    .get(email) as { user_id: number; course_uuid: string } | null;

  if (!enrolled) {
    return c.json({ ok: true });
  }

  try {
    const lh = new LearnhouseClient({
      baseUrl: env.LH_BASE_URL,
      orgSlug: env.LH_ORG_SLUG,
      adminToken: env.LH_ADMIN_TOKEN,
    });

    const link = await lh.issueMagicLink({
      user_id: enrolled.user_id,
      redirect_to: `/courses/${enrolled.course_uuid}`,
    });

    if (env.RESEND_API_KEY && env.RESEND_FROM) {
      const resend = new ResendClient({
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM,
      });
      const { subject, html } = magicLinkEmailHtml({
        magicLinkUrl: link.url,
        expiresAt: link.expires_at,
        brandName: env.LH_BRAND_NAME,
      });
      await resend.send({ to: email, subject, html });
    } else {
      console.log(
        JSON.stringify({
          event: "magic_link_reissue_no_email_sender",
          email,
          url: link.url,
          expires_at: link.expires_at,
        }),
      );
    }
  } catch (err) {
    console.error("[magic-reissue] failed", {
      email,
      err: err instanceof Error ? err.message : err,
    });
    // Still return 200 — don't leak internal failures.
  }

  return c.json({ ok: true });
});
