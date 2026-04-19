# services/bridge

Hono + Bun + TypeScript service that connects Grow by Meshulam (Israeli payments), LearnHouse (LMS), Webflow (marketing storefront), Mailchimp, and Resend.

## Routes

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness probe (used by UptimeRobot). |
| `POST` | `/webhooks/grow` | Grow payment / refund / chargeback events → LH enrollment, Mailchimp, Resend. |
| `POST` | `/webhooks/lh-course` | LH `course_*` events → Webflow CMS upsert (kept drift-free by construction). |
| `POST` | `/public/magic-link/request` | Public, unauthenticated: learner requests a fresh magic link after expiry. |

## Scripts

All invoked via `bun run <name>`:

- `reap-expired` — nightly cron. Unenrolls learners whose 12-month window has elapsed. `--dry-run` to preview.
- `replay --file=fixtures/sample.json` — re-dispatch a saved payload. Useful for local smoke tests.
- `replay --transaction-id=TX` — **stub**: fetch-from-Grow requires their API docs (auth-walled).
- `check-course-ids` — lists LH course UUIDs; manual cross-check vs. Grow product custom fields.
- `check-prices` — lists Webflow CMS prices; manual cross-check vs. Grow product prices.

## Run locally

```bash
bun install
cp .env.example .env   # fill what you can
bun run dev            # http://localhost:3001
```

Health check:

```bash
curl localhost:3001/health
# {"status":"ok","version":"0.1.0","lh_org":"default"}
```

Bad-signature webhook (proves handler chain runs):

```bash
curl -i -X POST http://localhost:3001/webhooks/grow \
  -H "Content-Type: application/json" \
  -H "X-Grow-Signature: deadbeef" \
  -d '{}'
# HTTP/1.1 401 Unauthorized
```

`bun run typecheck` should report zero errors.

## Architecture

```
                                       Grow payment
                                            │
                                            ▼
                                [POST /webhooks/grow]
                                            │
                        ┌───────────────────┼───────────────────┐
                        ▼                   ▼                   ▼
              LH admin: upsert     Mailchimp: tag          Resend: He
              user + enroll        as "buyer"              magic-link email
              (+ 12-mo expiry                              (reissuable at
               in SQLite)                                  /auth/magic/request)

LH course edit ──▶ [POST /webhooks/lh-course] ──▶ Webflow CMS upsert
                   (keyed on course_uuid; slug preserved on update)

Learner clicks expired link ──▶ LH page at /auth/magic/request
                                     │
                                     └──▶ [POST /public/magic-link/request]
                                          (rate-limited; only issues if
                                           SQLite shows active enrollment)

Daily cron ──▶ scripts/reap-expired.ts  (unenroll past expires_at)
```

## Persistence

SQLite at `SQLITE_PATH` (default `/var/lib/bridge/bridge.db`). Two tables:

- `processed_events` — idempotency on `(transaction_id, event_type)`. Re-posts short-circuit.
- `enrollments` — records `user_id → course_uuid` with 12-month `expires_at`. Reaper reads this.
- `magic_reissue_attempts` — rolling window for public reissue rate limiting.

Mount a Docker volume to `/var/lib/bridge` so the DB survives restarts.

## Blocked on

| Item | Owner | Why |
|------|-------|-----|
| `RESEND_API_KEY`, `RESEND_FROM`, verified sending domain | Operator | DKIM/SPF/DMARC required. Until then we log the link URL. |
| `GROW_WEBHOOK_SECRET` + real payload fixtures | Operator + Grow docs | Grow docs auth-walled at grow-il.readme.io. Schema tightens after first live webhook. |
| `MAILCHIMP_API_KEY`, `MAILCHIMP_LIST_ID` | Operator | Optional — bridge no-ops tagging if unset. |
| `WEBFLOW_API_TOKEN`, `WEBFLOW_SITE_ID`, `WEBFLOW_COURSES_COLLECTION_ID` | Operator | Needed for `/webhooks/lh-course` and `check-prices`. |
| `LH_ADMIN_TOKEN` minted at `POST /api/v1/orgs/{org_id}/api-tokens` | Operator | Rights: `users.{create,read,update}`, `enrollments.{create,delete}`, `courses.read`. |
| Actual Grow API integration for `replay --transaction-id=X` | Operator + Grow docs | Requires `GROW_API_TOKEN` + the fetch-by-ID endpoint shape. |

## Layout

```
services/bridge/
├── package.json           Bun + Hono + zod + TS
├── tsconfig.json
├── .env.example           every var the bridge will need
├── README.md              this file
├── scripts/
│   ├── reap-expired.ts    daily cron: unenroll past expires_at
│   ├── replay.ts          re-post a saved payload (--file) / fetch from Grow (TBD)
│   ├── check-course-ids.ts  drift audit vs. Grow products
│   └── check-prices.ts      drift audit vs. Webflow CMS
└── src/
    ├── index.ts           Hono app + route mounts
    ├── env.ts             zod env schema + loader
    ├── db.ts              SQLite bootstrap + processed_events + enrollments
    ├── clients/
    │   ├── learnhouse.ts  typed LH admin client
    │   ├── mailchimp.ts   list upsert + tag
    │   ├── resend.ts      transactional email + He templates
    │   └── webflow.ts     Webflow Data API v2 (collection items)
    ├── types/
    │   ├── learnhouse.ts  mirrors of LH Pydantic models
    │   └── grow.ts        provisional Grow webhook schema
    └── webhooks/
        ├── grow.ts              payment/refund/chargeback handler
        ├── lh-course.ts         LH → Webflow CMS sync handler
        └── magic-reissue.ts     public magic-link reissue endpoint
```
