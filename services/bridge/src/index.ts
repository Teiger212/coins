import { Hono } from "hono";
import { loadEnv } from "./env.ts";
import { growWebhook } from "./webhooks/grow.ts";
import { lhCourseWebhook } from "./webhooks/lh-course.ts";
import { magicReissueRoute } from "./webhooks/magic-reissue.ts";

const env = loadEnv();
const app = new Hono();

app.get("/health", (c) =>
  c.json({ status: "ok", version: "0.1.0", lh_org: env.LH_ORG_SLUG }),
);

app.route("/webhooks", growWebhook);
app.route("/webhooks", lhCourseWebhook);
app.route("/public", magicReissueRoute);

app.onError((err, c) => {
  console.error("[bridge] unhandled error", err);
  return c.json({ error: "internal error" }, 500);
});

export default {
  port: env.PORT,
  fetch: app.fetch,
};
