/**
 * Use case 1 — pizza shop outbound order callback.
 *
 * You take a web order, then call the customer back to confirm it. The
 * order details are pushed via `custom_data` so the agent speaks from the
 * real order — no pre-staging on the platform side required.
 *
 * Run: AUDELO_KEY=cgk_... npx tsx examples/pizza-shop-callback.ts
 */

import { AudeloClient } from '../src/index.js';

const cg = new AudeloClient({ apiKey: process.env.AUDELO_KEY! });

async function main() {
  const orderId = 'ORD-4471';
  const customer = { name: 'Alice', phone: '+61412345678' };

  // 1. Queue the call with the order details in custom_data — this is what
  //    the agent actually speaks from. DNC + calling-hours + concurrency
  //    caps run server-side; if the customer is on the DNC list the call is
  //    silently skipped (surfaces as `status: 'failed'`, reason `dnc_match`,
  //    when you poll cg.calls.get() for the materialized call record).
  const call = await cg.calls.initiate({
    agent_id: 42,
    phone_number: customer.phone,
    caller_name: customer.name,
    dial_pipeline: 'livekit', // required for custom_data to reach the agent
    custom_data: {
      order_id: orderId,
      items: ['large_pepperoni', '2L_coke'],
      ready_at: '2026-05-07T18:30:00Z',
    },
    // idempotency_key prevents accidental double-calls if this request retries.
    idempotency_key: `order-${orderId}`,
  });

  console.log('Call queued:', call.call_id, call.status);

  // 2. (Optional) keep your own record too, e.g. for audit — the context
  //    store isn't read by the live agent, so this is bookkeeping only,
  //    not a second way to get the data spoken.
  await cg.context.set(
    `order:${orderId}`,
    { customer_name: customer.name, items: ['large_pepperoni', '2L_coke'], ready_at: '2026-05-07T18:30:00Z' },
    60 * 60 // 1h TTL — gone before the next billing day
  );

  // 3. Wire a webhook endpoint (see webhook-receiver.ts — register it once
  //    via cg.webhooks.create(), then run that file as your receiving
  //    server) subscribed to call.started / call.transcript / call.ended to
  //    track this call through to completion — match it back via
  //    data.outbound_target_id === call.call_id.
}

main().catch((err) => {
  console.error('Pizza callback failed:', err);
  process.exitCode = 1;
});
