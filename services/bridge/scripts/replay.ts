#!/usr/bin/env bun
/**
 * Replay a Grow transaction through the bridge webhook handler.
 *
 * Two modes:
 *   1. --transaction-id=TX  — fetch the transaction from Grow and re-dispatch.
 *                              Requires GROW_API_TOKEN + Grow API schema,
 *                              both TBD (docs at grow-il.readme.io are
 *                              auth-walled). Emits a clear error until wired.
 *   2. --file=path.json     — re-dispatch a saved webhook payload from disk.
 *                              Useful for local smoke tests.
 *
 * Usage:
 *   bun run scripts/replay.ts --file=fixtures/sample-payment.json
 *   bun run scripts/replay.ts --transaction-id=TX123
 */
import { loadEnv } from "../src/env.ts";

interface Args {
  transactionId: string | null;
  file: string | null;
  url: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  let transactionId: string | null = null;
  let file: string | null = null;
  let url = "http://localhost:3001/webhooks/grow";
  for (const arg of a) {
    if (arg.startsWith("--transaction-id=")) transactionId = arg.slice("--transaction-id=".length);
    else if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
  }
  return { transactionId, file, url };
}

async function postSigned(url: string, body: string, secret: string) {
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(body);
  const sig = hasher.digest("hex");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Grow-Signature": sig,
    },
    body,
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);
  if (res.status >= 300) process.exit(1);
}

async function main() {
  const args = parseArgs();
  const env = loadEnv();

  if (!env.GROW_WEBHOOK_SECRET) {
    console.error("GROW_WEBHOOK_SECRET must be set to replay");
    process.exit(2);
  }

  if (args.file) {
    const raw = await Bun.file(args.file).text();
    await postSigned(args.url, raw, env.GROW_WEBHOOK_SECRET);
    return;
  }

  if (args.transactionId) {
    // TODO(grow-api): once we have GROW_API_TOKEN + the documented
    // "get transaction by ID" endpoint, fetch it here and convert to the
    // webhook payload shape. Grow's docs are auth-walled at grow-il.readme.io.
    console.error(
      `Grow API fetch not wired yet. Re-send from the Grow dashboard,\n` +
        `or save the payload to a file and replay with --file=path.json.`,
    );
    process.exit(2);
  }

  console.error("Usage: replay.ts --file=PATH  |  --transaction-id=TX  [--url=WEBHOOK_URL]");
  process.exit(2);
}

main();
