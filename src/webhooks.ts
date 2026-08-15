/**
 * Signature verification for Audelo webhook deliveries AND `customer_lookup`
 * requests — both use the IDENTICAL scheme (confirmed directly against the
 * platform source, not re-derived from docs alone):
 *
 *   sha256=<hex of HMAC-SHA256(rawRequestBody, secret)>
 *
 * sent in the `X-Audelo-Signature` header. Webhook secrets are `whsec_...`;
 * `customer_lookup` secrets are `dlsec_...` — the verification function is
 * the same for both, only the secret differs.
 *
 * IMPORTANT: verify against the RAW request body bytes/string exactly as
 * received — not a re-serialized `JSON.stringify(req.body)`. Most Node HTTP
 * frameworks parse JSON before your handler runs, which can reorder keys or
 * normalize whitespace; that would break verification even with the correct
 * secret. Capture the raw body with your framework's raw-body middleware
 * (e.g. Express: `express.raw({ type: 'application/json' })`, or a `verify`
 * callback on `express.json()`).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute the expected `X-Audelo-Signature` value for a given raw body and
 * secret. Exposed mainly for tests/debugging — most integrations should use
 * `verifyWebhookSignature()` instead of comparing this manually.
 */
export function computeSignature(rawBody: string | Buffer, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Verify a webhook delivery (or `customer_lookup` request) is genuinely
 * from Audelo. Returns `false` on any mismatch, malformed header, or
 * length mismatch — never throws on attacker-controlled input.
 *
 * @param rawBody          The exact raw request body bytes/string as received.
 * @param signatureHeader  The `X-Audelo-Signature` header value, e.g. `"sha256=abcd..."`.
 * @param secret           Your endpoint's `whsec_...` (webhook) or `dlsec_...`
 *                          (customer_lookup) secret.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;

  const expected = computeSignature(rawBody, secret);

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Alias for `verifyWebhookSignature` — same scheme, used for verifying an
 * inbound `customer_lookup` request instead of a webhook delivery. Kept as
 * a distinct name purely for call-site clarity; behaviour is identical.
 */
export const verifyCustomerLookupSignature = verifyWebhookSignature;
