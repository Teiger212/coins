#!/usr/bin/env bun
/**
 * Consistency check: every Grow product's `course_id` custom field must
 * correspond to a real course_uuid in LH. Missing IDs = broken Buy buttons
 * or future enrollment failures, so this script is wired to fail loudly
 * (exit 1) so a cron or CI job can page the operator.
 *
 * Grow API integration: TBD — docs at grow-il.readme.io are auth-walled.
 * Until wired, this lists all LH course UUIDs and prints the command to
 * cross-check manually against Grow's product list.
 */
import { loadEnv } from "../src/env.ts";

interface CourseSummary {
  course_uuid: string;
  name: string;
}

async function fetchLhCourses(env: ReturnType<typeof loadEnv>): Promise<CourseSummary[]> {
  if (!env.LH_ADMIN_TOKEN) throw new Error("LH_ADMIN_TOKEN is required");
  const url = `${env.LH_BASE_URL.replace(/\/$/, "")}/api/v1/orgs/slug/${env.LH_ORG_SLUG}/courses?page=1&limit=500`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.LH_ADMIN_TOKEN}` },
  });
  if (!res.ok) throw new Error(`LH courses list failed: HTTP ${res.status}`);
  const data = (await res.json()) as Array<{ course_uuid: string; name: string }>;
  return data.map((c) => ({ course_uuid: c.course_uuid, name: c.name }));
}

async function main() {
  const env = loadEnv();
  const courses = await fetchLhCourses(env);

  console.log(`LH has ${courses.length} course(s):`);
  for (const c of courses) console.log(`  ${c.course_uuid}  ${c.name}`);

  // TODO(grow-api): fetch Grow products, extract each product's course_id
  // custom field, diff against the LH set, exit 1 on mismatch. Until wired,
  // print the manual checklist and exit 0 so the script runs clean.
  console.log("\n[manual] cross-check each course_uuid is listed as a hidden");
  console.log("         custom field on at least one Grow product.");
  console.log("         Grow dashboard → Products → (product) → Custom fields.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
