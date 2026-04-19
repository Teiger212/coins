import { Hono } from "hono";
import { z } from "zod";
import { loadEnv, requireForLhCourseWebhook } from "../env.ts";
import { WebflowClient, slugify } from "../clients/webflow.ts";

export const lhCourseWebhook = new Hono();

// Envelope matches apps/api/src/services/webhooks/dispatch.py:164-170.
const Envelope = z.object({
  event: z.enum(["course_created", "course_updated", "course_deleted", "course_published"]),
  delivery_id: z.string().min(1),
  timestamp: z.string().min(1),
  org_id: z.number().int().positive(),
  data: z
    .object({
      course_uuid: z.string().min(1),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      about: z.string().optional(),
      published: z.boolean().optional(),
    })
    .passthrough(),
});

const LH_SIGNATURE_HEADER = "x-webhook-signature";

lhCourseWebhook.post("/lh-course", async (c) => {
  const env = loadEnv();
  requireForLhCourseWebhook(env);

  const sig = c.req.header(LH_SIGNATURE_HEADER);
  if (!sig) return c.json({ error: "missing signature" }, 401);

  const raw = await c.req.text();
  if (!verifyLhSignature(raw, sig, env.LH_COURSE_WEBHOOK_SECRET)) {
    return c.json({ error: "invalid signature" }, 401);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const parsed = Envelope.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "invalid envelope", issues: parsed.error.issues }, 400);
  }

  const { event, data } = parsed.data;

  const webflow = new WebflowClient({
    apiToken: env.WEBFLOW_API_TOKEN,
    siteId: env.WEBFLOW_SITE_ID,
    collectionId: env.WEBFLOW_COURSES_COLLECTION_ID,
  });

  try {
    const existing = await webflow.findByCourseUuid(data.course_uuid);

    if (event === "course_deleted") {
      if (existing) {
        await webflow.archiveItem(existing.id);
        return c.json({ ok: true, action: "archived", webflow_item_id: existing.id });
      }
      return c.json({ ok: true, action: "noop_not_found" });
    }

    const fieldData = {
      name: data.name ?? "",
      slug: slugify(data.name ?? data.course_uuid),
      "course-uuid": data.course_uuid,
      description: data.description ?? "",
      about: data.about ?? "",
      published: data.published ?? false,
    };

    if (existing) {
      // Preserve the Webflow-side slug to keep existing URLs stable.
      const preserved = { ...fieldData, slug: String(existing.fieldData.slug ?? fieldData.slug) };
      const updated = await webflow.updateItem(existing.id, preserved);
      return c.json({ ok: true, action: "updated", webflow_item_id: updated.id });
    } else {
      const created = await webflow.createItem(fieldData);
      return c.json({ ok: true, action: "created", webflow_item_id: created.id });
    }
  } catch (err) {
    console.error("[lh-course] handler failed", { event, course_uuid: data.course_uuid, err });
    return c.json(
      { error: "handler failed", message: err instanceof Error ? err.message : "unknown" },
      500,
    );
  }
});

/**
 * LH sends `X-Webhook-Signature: sha256=<hex>` of the raw body
 * (apps/api/src/services/webhooks/crypto.py:38-46).
 */
function verifyLhSignature(body: string, headerValue: string, secret: string): boolean {
  const [algo, hex] = headerValue.split("=");
  if (algo !== "sha256" || !hex) return false;
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(body);
  const expected = hasher.digest("hex");
  return timingSafeEqHex(hex, expected);
}

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
