/**
 * Use case 3 — e-commerce live support handoff.
 *
 * A logged-in shopper clicks "Talk to us." Your frontend posts to your own
 * backend, which places the call with the shopper's cart context pushed via
 * custom_data, then streams the live transcript back to their browser as
 * the agent talks — a lightweight in-page "call in progress" experience.
 *
 * Run: AUDELO_KEY=cgk_... npx tsx examples/ecommerce-handoff.ts
 */

import { AudeloClient } from '../src/index.js';

const cg = new AudeloClient({ apiKey: process.env.AUDELO_KEY! });

interface Shopper {
  phone: string;
  cart: { total: number; lines: Array<{ name: string }> };
  support: { last_subject: string };
}

async function handleTalkToUsClick(shopper: Shopper) {
  const call = await cg.calls.initiate({
    agent_id: 99, // support-tuned agent
    phone_number: shopper.phone,
    dial_pipeline: 'livekit', // required for custom_data to reach the agent
    custom_data: {
      cart_total_cents: shopper.cart.total,
      items: shopper.cart.lines.map((l) => l.name),
      last_help_request: shopper.support.last_subject,
    },
  });

  console.log('Support call queued:', call.call_id);

  // Optionally, once the call has connected (poll cg.calls.get() for the
  // real numeric id, or wait for the call.started webhook), mint a
  // listen-only token so the shopper's OWN browser tab can hear the call
  // in-page — a different use of the same live infrastructure the takeover
  // endpoint uses, just listen-only and not gated to your own staff:
  //
  //   const realCallId = /* resolved numeric id */;
  //   const listenToken = await cg.calls.listen(realCallId);
  //   // hand `listenToken.url` / `listenToken.token` to your frontend,
  //   // which connects with the `livekit-client` package.

  // Stream the transcript to the shopper's browser through your own
  // WebSocket: on each call.transcript webhook (see webhook-receiver.ts),
  // fan the turn out to any sockets subscribed to this call.
  return call;
}

handleTalkToUsClick({
  phone: '+61412345678',
  cart: { total: 12995, lines: [{ name: 'Wireless earbuds' }, { name: 'Charging case' }] },
  support: { last_subject: 'Order not yet shipped' },
}).catch((err) => {
  console.error('Support handoff failed:', err);
  process.exitCode = 1;
});
