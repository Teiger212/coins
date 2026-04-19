import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),

  LH_BASE_URL: z.string().url(),
  LH_ORG_SLUG: z.string().min(1),
  LH_ADMIN_TOKEN: z.string().min(1).optional(),
  LH_BRAND_NAME: z.string().min(1).default("חופשי"),

  GROW_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Access window in days. 12 months ≈ 365 days. Tunable without a redeploy.
  ENROLLMENT_TTL_DAYS: z.coerce.number().int().positive().default(365),

  // SQLite idempotency + enrollment-tracking store. Directory must be writable.
  SQLITE_PATH: z.string().min(1).default("/var/lib/bridge/bridge.db"),

  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().email().optional(),

  MAILCHIMP_API_KEY: z.string().min(1).optional(),
  MAILCHIMP_LIST_ID: z.string().min(1).optional(),

  // LH → Webflow course sync (Phase 5). Optional; only required when running
  // the /webhooks/lh-course handler.
  LH_COURSE_WEBHOOK_SECRET: z.string().min(1).optional(),
  WEBFLOW_API_TOKEN: z.string().min(1).optional(),
  WEBFLOW_SITE_ID: z.string().min(1).optional(),
  WEBFLOW_COURSES_COLLECTION_ID: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  cached = parsed.data;
  return cached;
}

export function requireForGrowWebhook(env: Env): asserts env is Env & {
  LH_ADMIN_TOKEN: string;
  GROW_WEBHOOK_SECRET: string;
} {
  if (!env.LH_ADMIN_TOKEN) {
    throw new Error("LH_ADMIN_TOKEN is required to handle webhooks");
  }
  if (!env.GROW_WEBHOOK_SECRET) {
    throw new Error("GROW_WEBHOOK_SECRET is required to verify webhooks");
  }
}

export function requireForLhCourseWebhook(env: Env): asserts env is Env & {
  LH_COURSE_WEBHOOK_SECRET: string;
  WEBFLOW_API_TOKEN: string;
  WEBFLOW_SITE_ID: string;
  WEBFLOW_COURSES_COLLECTION_ID: string;
} {
  const missing: string[] = [];
  if (!env.LH_COURSE_WEBHOOK_SECRET) missing.push("LH_COURSE_WEBHOOK_SECRET");
  if (!env.WEBFLOW_API_TOKEN) missing.push("WEBFLOW_API_TOKEN");
  if (!env.WEBFLOW_SITE_ID) missing.push("WEBFLOW_SITE_ID");
  if (!env.WEBFLOW_COURSES_COLLECTION_ID) missing.push("WEBFLOW_COURSES_COLLECTION_ID");
  if (missing.length > 0) {
    throw new Error(`Missing env for LH course webhook: ${missing.join(", ")}`);
  }
}
