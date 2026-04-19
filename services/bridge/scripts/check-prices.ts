#!/usr/bin/env bun
/**
 * Consistency check: Grow product price must equal the price shown on the
 * Webflow course page. Drift here means learners get confused or underpay.
 *
 * Grow API: TBD (auth-walled docs). Until wired, this dumps the Webflow
 * CMS side as the source we have credentials for, and prints a reminder
 * to manually cross-check against the Grow product list.
 */
import { loadEnv } from "../src/env.ts";
import { WebflowClient } from "../src/clients/webflow.ts";

async function main() {
  const env = loadEnv();
  if (!env.WEBFLOW_API_TOKEN || !env.WEBFLOW_SITE_ID || !env.WEBFLOW_COURSES_COLLECTION_ID) {
    console.error("WEBFLOW_{API_TOKEN,SITE_ID,COURSES_COLLECTION_ID} must be set");
    process.exit(2);
  }

  const webflow = new WebflowClient({
    apiToken: env.WEBFLOW_API_TOKEN,
    siteId: env.WEBFLOW_SITE_ID,
    collectionId: env.WEBFLOW_COURSES_COLLECTION_ID,
  });

  // Read entire collection. Uses the v2 list endpoint — small sites only.
  const res = await fetch(
    `https://api.webflow.com/v2/collections/${env.WEBFLOW_COURSES_COLLECTION_ID}/items?limit=100`,
    { headers: { Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}` } },
  );
  if (!res.ok) {
    console.error(`Webflow list failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const data = (await res.json()) as {
    items: Array<{ id: string; fieldData: Record<string, unknown> }>;
  };

  console.log(`Webflow has ${data.items.length} course item(s):`);
  for (const item of data.items) {
    const fd = item.fieldData;
    console.log(
      `  ${String(fd["course-uuid"] ?? "(no uuid)")}   price=${String(fd.price ?? "?")}   ${String(fd.name ?? "")}`,
    );
  }

  console.log("\n[manual] cross-check each price against the corresponding Grow product.");
  console.log("         A mismatch means either Webflow CMS drift or a stale Grow price.");
  void webflow; // reserved for future upserts
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
