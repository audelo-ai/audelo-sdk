/**
 * Companion to every other example — a minimal Express server that receives
 * webhook deliveries (call.started / call.ended / call.transcript / etc.)
 * and verifies the X-Audelo-Signature header before trusting the payload.
 *
 * Not one of the 4 documented use cases on its own, but every use case that
 * places or receives a call needs this half of the picture, and it's the
 * only example that exercises `verifyWebhookSignature` against a genuine
 * webhook delivery (examples/therapist-intake.ts exercises the identical
 * scheme, but for a customer_lookup request instead).
 *
 * Register the endpoint once, e.g.:
 *   const { secret } = await cg.webhooks.create({
 *     url: 'https://yourapp.com/audelo/webhook',
 *     events: ['call.started', 'call.ended', 'call.transcript'],
 *   });
 *   // Store `secret` (whsec_...) as WEBHOOK_SECRET below — shown once.
 *
 * Run: WEBHOOK_SECRET=whsec_... npx tsx examples/webhook-receiver.ts
 */

import express from 'express';
import { verifyWebhookSignature } from '../src/webhooks.js';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

const app = express();

// IMPORTANT: verify against the RAW body, not a re-parsed/re-serialized one.
// express.raw() gives us exactly the bytes Audelo signed.
app.post(
  '/audelo/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signature = req.header('X-Audelo-Signature');
    const rawBody = req.body as Buffer; // Buffer, thanks to express.raw()

    if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    const event = JSON.parse(rawBody.toString('utf8'));

    switch (event.event) {
      case 'call.started':
        console.log(`Call ${event.data.call_id} started (${event.data.direction})`);
        break;
      case 'call.transcript':
        console.log(`[${event.data.speaker}] ${event.data.text}`);
        break;
      case 'call.ended':
        console.log(`Call ${event.data.call_id} ended: ${event.data.status}, ${event.data.duration_sec}s`);
        break;
      case 'booking.created':
        console.log(`Booking ${event.data.booking_id} for ${event.data.customer_name}`);
        break;
      case 'lead.captured':
        console.log(`Lead captured: ${event.data.caller_name} (${event.data.caller_phone})`);
        break;
      case 'call.summary.ready':
        console.log(`Summary ready for call ${event.data.call_id}: ${event.data.summary}`);
        break;
      case 'sms.received':
        console.log(`Inbound SMS from ${event.data.from}: ${event.data.body}`);
        break;
      default:
        console.log('Unhandled event type:', event.event);
    }

    // Respond 2xx quickly — Audelo retries non-2xx / timeouts up to 5 times
    // (5s, 30s, 5m, 30m, 2h backoff), and auto-disables the endpoint after
    // 10 consecutive failures. Do slow work (DB writes, downstream calls)
    // asynchronously after responding, not before.
    res.status(200).json({ received: true });
  }
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Webhook receiver listening on :${port}`));
