import { Hono } from "hono";
import { loadEnv, requireForGrowWebhook } from "../env.ts";
import { LearnhouseClient } from "../clients/learnhouse.ts";
import { MailchimpClient, parseServerPrefix } from "../clients/mailchimp.ts";
import {
  ResendClient,
  magicLinkEmailHtml,
  refundEmailHtml,
} from "../clients/resend.ts";
import {
  GROW_SIGNATURE_HEADER,
  GrowWebhookSchema,
  type GrowWebhookPayload,
} from "../types/grow.ts";
import {
  getDb,
  findProcessedEvent,
  recordEnrollment,
  recordProcessedEvent,
  revokeEnrollment,
} from "../db.ts";

export const growWebhook = new Hono();

growWebhook.post("/grow", async (c) => {
  const env = loadEnv();
  requireForGrowWebhook(env);

  const sig = c.req.header(GROW_SIGNATURE_HEADER);
  if (!sig) return c.json({ error: "missing signature" }, 401);

  const raw = await c.req.text();
  if (!verifyHmac(raw, sig, env.GROW_WEBHOOK_SECRET)) {
    return c.json({ error: "invalid signature" }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = GrowWebhookSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "invalid payload", issues: parsed.error.issues }, 400);
  }
  const payload = parsed.data;

  const db = getDb(env.SQLITE_PATH);

  // Idempotency: Grow may retry on timeout. Short-circuit and return the
  // previously-recorded result if we've already processed this transaction.
  const prior = findProcessedEvent(db, payload.transaction_id);
  if (prior && prior.event_type === payload.event_type) {
    return c.json({
      ok: true,
      idempotent: true,
      event_type: prior.event_type,
      result: prior.result_json ? JSON.parse(prior.result_json) : null,
    });
  }

  const lh = new LearnhouseClient({
    baseUrl: env.LH_BASE_URL,
    orgSlug: env.LH_ORG_SLUG,
    adminToken: env.LH_ADMIN_TOKEN,
  });
  const mailchimp = buildMailchimp(env);
  const resend = buildResend(env);

  try {
    let result: Record<string, unknown>;
    if (payload.event_type === "payment_success") {
      result = await handlePaymentSuccess({ env, payload, lh, mailchimp, resend });
    } else {
      // refund + chargeback share one handler — both revoke access.
      result = await handleRefund({ env, payload, lh, mailchimp, resend });
    }

    recordProcessedEvent(db, {
      transaction_id: payload.transaction_id,
      event_type: payload.event_type,
      email: payload.email,
      course_uuid: payload.custom_fields?.course_uuid ?? null,
      payload_json: raw,
      result_json: JSON.stringify(result),
    });

    return c.json({ ok: true, event_type: payload.event_type, ...result });
  } catch (err) {
    console.error("[grow] handler failed", {
      event_type: payload.event_type,
      transaction_id: payload.transaction_id,
      err,
    });
    // Do NOT record on failure — we want the retry to actually re-run.
    return c.json(
      { error: "handler failed", message: err instanceof Error ? err.message : "unknown" },
      500,
    );
  }
});

interface Deps {
  env: ReturnType<typeof loadEnv>;
  payload: GrowWebhookPayload;
  lh: LearnhouseClient;
  mailchimp: MailchimpClient | null;
  resend: ResendClient | null;
}

async function handlePaymentSuccess(
  deps: Deps,
): Promise<Record<string, unknown>> {
  const { env, payload, lh, mailchimp, resend } = deps;

  const courseUuid = payload.custom_fields?.course_uuid;
  if (!courseUuid) {
    throw new Error("payment_success payload missing custom_fields.course_uuid");
  }

  const { firstName, lastName } = splitName(payload.full_name);

  let user = await lh.getUserByEmail(payload.email);
  if (!user) {
    user = await lh.provisionUser({
      email: payload.email,
      username: usernameFromEmail(payload.email),
      first_name: firstName,
      last_name: lastName,
    });
  }

  const enrollment = await lh.enrollUser({
    userId: user.id,
    courseUuid,
  });

  // Persist the enrollment window; a nightly reaper (services/bridge/scripts)
  // runs `unenrollUser` on rows past expires_at. LH has no native expiry field.
  const expiresAt = new Date(
    Date.now() + env.ENROLLMENT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const db = getDb(env.SQLITE_PATH);
  recordEnrollment(db, {
    user_id: user.id,
    email: payload.email,
    course_uuid: courseUuid,
    transaction_id: payload.transaction_id,
    expires_at: expiresAt,
  });

  const link = await lh.issueMagicLink({
    user_id: user.id,
    redirect_to: `/courses/${courseUuid}`,
  });

  let emailId: string | null = null;
  if (resend) {
    const { subject, html } = magicLinkEmailHtml({
      magicLinkUrl: link.url,
      expiresAt: link.expires_at,
      brandName: env.LH_BRAND_NAME,
    });
    const sent = await resend.send({ to: payload.email, subject, html });
    emailId = sent.id;
  } else {
    // Operator hasn't wired Resend yet. Log the URL so it can be relayed by hand.
    console.log(
      JSON.stringify({
        event: "magic_link_ready_no_email_sender",
        transaction_id: payload.transaction_id,
        url: link.url,
        expires_at: link.expires_at,
      }),
    );
  }

  if (mailchimp) {
    await mailchimp.upsertMember({
      email: payload.email,
      firstName,
      lastName,
      tags: ["buyer", courseTag(courseUuid)],
    });
  }

  return {
    user_id: user.id,
    already_enrolled: enrollment.alreadyEnrolled,
    enrollment_expires_at: expiresAt,
    magic_link_expires_at: link.expires_at,
    email_id: emailId,
  };
}

async function handleRefund(deps: Deps): Promise<Record<string, unknown>> {
  const { env, payload, lh, mailchimp, resend } = deps;
  const db = getDb(env.SQLITE_PATH);

  // Look up the original purchase — refunds / chargebacks may not carry the
  // course_uuid themselves.
  let courseUuid = payload.custom_fields?.course_uuid ?? null;
  if (!courseUuid) {
    const original = findProcessedEvent(db, payload.transaction_id);
    courseUuid = original?.course_uuid ?? null;
  }

  const user = await lh.getUserByEmail(payload.email);
  if (!user) {
    return { skipped: true, reason: "no LH user for email" };
  }

  let notEnrolled = true;
  if (courseUuid) {
    const r = await lh.unenrollUser({ userId: user.id, courseUuid });
    notEnrolled = r.notEnrolled;
    revokeEnrollment(db, { user_id: user.id, course_uuid: courseUuid });
  }

  if (mailchimp) {
    await mailchimp.addTags({ email: payload.email, tags: ["refunded"] });
  }

  if (resend && courseUuid) {
    const { subject, html } = refundEmailHtml({ brandName: env.LH_BRAND_NAME });
    await resend.send({ to: payload.email, subject, html });
  }

  return {
    user_id: user.id,
    course_uuid: courseUuid,
    was_enrolled: !notEnrolled,
  };
}

function buildMailchimp(env: ReturnType<typeof loadEnv>): MailchimpClient | null {
  if (!env.MAILCHIMP_API_KEY || !env.MAILCHIMP_LIST_ID) return null;
  return new MailchimpClient({
    apiKey: env.MAILCHIMP_API_KEY,
    listId: env.MAILCHIMP_LIST_ID,
    serverPrefix: parseServerPrefix(env.MAILCHIMP_API_KEY),
  });
}

function buildResend(env: ReturnType<typeof loadEnv>): ResendClient | null {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return null;
  return new ResendClient({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM });
}

function splitName(full?: string): { firstName: string; lastName: string } {
  if (!full) return { firstName: "", lastName: "" };
  const parts = full.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function usernameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "user";
}

function courseTag(courseUuid: string): string {
  // Mailchimp tags are surfaced in the UI; keep readable but bounded.
  return `course-${courseUuid.slice(0, 8)}`;
}

function verifyHmac(body: string, headerValue: string, secret: string): boolean {
  // TODO(grow): confirm signature format from a real test webhook.
  // Most providers send hex-encoded HMAC-SHA256 of the raw body. Some
  // prefix the algorithm (e.g. "sha256=..."). This handles both.
  const presented = headerValue.includes("=") ? headerValue.split("=").pop()! : headerValue;
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(body);
  const expected = hasher.digest("hex");
  return timingSafeEqHex(presented, expected);
}

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
