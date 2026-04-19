// Best-effort Grow by Meshulam webhook payload shape.
// TODO(operator): replace with the real schema after first test webhook lands.
// Grow's docs are HE-only and behind login; we'll only know the exact shape
// (field names, casing, signature header name + format) after the operator
// configures their account and triggers a 1₪ test transaction.

import { z } from "zod";

export const GROW_EVENT_TYPES = [
  "payment_success",
  "refund",
  "chargeback",
] as const;

export type GrowEventType = (typeof GROW_EVENT_TYPES)[number];

// Provisional schema. Tighten once we have a real payload.
export const GrowWebhookSchema = z
  .object({
    // Default to "payment_success" so legacy single-event payloads keep working.
    event_type: z.enum(GROW_EVENT_TYPES).default("payment_success"),
    transaction_id: z.string().min(1),
    email: z.string().email(),
    full_name: z.string().optional(),
    amount: z.coerce.number().optional(),
    currency: z.string().optional(),
    // Grow carries the course UUID as a hidden custom field on the product.
    // `course_uuid` is required for payment_success; for refund/chargeback
    // we fall back to looking it up by transaction_id via our SQLite store.
    custom_fields: z
      .object({
        course_uuid: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type GrowWebhookPayload = z.infer<typeof GrowWebhookSchema>;

// Header that Grow sends with the HMAC signature. Name TBD; Stripe uses
// `Stripe-Signature`, GitHub uses `X-Hub-Signature-256`. Update when known.
export const GROW_SIGNATURE_HEADER = "x-grow-signature";
