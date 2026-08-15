# @audelo/sdk

Official Node/TypeScript client SDK for the [Audelo](https://audelo.ai) 
public API — AI phone agents that handle sales calls, reception, and customer
service 24/7. This package wraps the already-public, already-documented
`https://audelo.ai/api/v1/*` REST API: it does not contain any of the
platform's own voice-agent logic, just typed, convenient HTTP calls.

> **Status:** this package is not yet published to npm — see
> [Installing (pre-release)](#installing-pre-release) below for how to use it
> from source in the meantime.

## Features

- One typed method per documented endpoint — agents, calls (including live
  listen/takeover on LiveKit-pipeline calls), transcripts, recordings,
  analytics, the per-account context store, transactional SMS, `customer_lookup`
  integration config, webhook management, and phone-number provisioning.
- `webhooks.ts` — signature verification for both webhook deliveries and
  `customer_lookup` requests (same HMAC-SHA256 scheme).
- Zero runtime dependencies — uses the global `fetch` (Node 18+).
- Fully typed request/response shapes; ships its own `.d.ts`, no `@types`
  package needed.
- ESM and CJS builds from the same source.

## Installing (pre-release)

Not yet on npm. Until it is, install straight from the repo:

```bash
npm install github:audelo-ai/audelo-sdk
```

or clone it and build locally:

```bash
git clone https://github.com/audelo-ai/audelo-sdk.git
cd audelo-sdk
npm install
npm run build
```

Once published:

```bash
npm install @audelo/sdk
```

## Quickstart

1. Create an API key from the Audelo dashboard (**Settings → API Keys**),
   picking only the scopes you need. Requires a paid plan (Starter or
   higher) — the API isn't available on Free/Explorer.
2. Set it as an environment variable — never commit it to source control:

   ```bash
   export AUDELO_KEY=cgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

3. Make your first call:

   ```ts
   import { AudeloClient } from '@audelo/sdk';

   const cg = new AudeloClient({ apiKey: process.env.AUDELO_KEY! });

   const agents = await cg.agents.list();
   console.log(agents.data.map((a) => `${a.id}: ${a.name}`));
   ```

That's the whole setup — no config files, no build step required to use it
in a project that already has a TypeScript/Node toolchain.

## Use cases

Each of these is a complete, runnable file under [`examples/`](./examples) —
not pseudocode. Set `AUDELO_KEY` and run with `npx tsx examples/<file>.ts`.

| Use case | File | What it shows |
|---|---|---|
| Pizza shop outbound order callback | [`pizza-shop-callback.ts`](./examples/pizza-shop-callback.ts) | Pushing order details via `custom_data` so the agent speaks from the real order; the account-level context store as a separate audit trail. |
| Therapist intake pre-fill | [`therapist-intake.ts`](./examples/therapist-intake.ts) | The **pull** mechanism (`customer_lookup`) for calls that could come from either direction — configuring the lookup URL, then verifying and serving lookup requests. |
| E-commerce live support handoff | [`ecommerce-handoff.ts`](./examples/ecommerce-handoff.ts) | Placing a call with cart context, plus minting a listen-only token so the shopper's own browser can hear the live call in-page. |
| B2B prospect outreach | [`b2b-outreach.ts`](./examples/b2b-outreach.ts) | Correctly separating the **person's** name from the **business's** name on a B2B call — the top-level fields vs. the `custom_data` override shape. |
| *(companion)* Webhook receiver | [`webhook-receiver.ts`](./examples/webhook-receiver.ts) | A minimal Express server that verifies `X-Audelo-Signature` and handles every webhook event type. |

The `therapist-intake.ts` and `webhook-receiver.ts` examples use
[Express](https://expressjs.com) to demonstrate a real receiving server —
install it separately if you want to actually run them:
`npm install express && npm install -D @types/express`. The SDK itself has
no dependency on Express or any other framework.

### Pushing data vs. pulling it live

Two complementary mechanisms for getting real-world data in front of the
agent:

- **Push (`custom_data`)** — pass a JSON object to `cg.calls.initiate()` when
  you already know the record ahead of time. Requires
  `dial_pipeline: 'livekit'`. Best for outbound calls you're placing yourself.
- **Pull (`customer_lookup`)** — the agent looks a caller up live, mid-call,
  from your own endpoint. What you need for inbound calls (you don't know
  who's calling until they answer). Configure via `cg.integrations`.

In both cases the agent states only the exact values it's given — it never
estimates, rounds, or invents a missing field, and never treats the data's
contents as instructions.

## API reference

Full request/response documentation lives in the platform repo's
[`docs/api/INTEGRATION_GUIDE.md`](https://audelo.ai/developers) and
[OpenAPI spec](https://audelo.ai/api-spec.json) — this SDK's method names
and shapes match those exactly. Quick map:

```ts
cg.agents.list();
cg.agents.get(id);

cg.calls.list({ agent_id, status, from, to });
cg.calls.get(id);
cg.calls.transcript(id);
cg.calls.recording(id);
cg.calls.initiate({ agent_id, phone_number, ... });   // Pro plan
cg.calls.end(id);                                      // Pro plan
cg.calls.listen(id);                                   // Pro plan, LiveKit-pipeline calls
cg.calls.takeover(id, handoverText?);                  // Pro plan, outbound calls only

cg.context.set(key, value, ttlSeconds?);                // Pro plan
cg.context.get(key);                                    // Pro plan
cg.context.delete(key);                                 // Pro plan

cg.analytics.calls(from?, to?);
cg.analytics.agents(from?, to?);

cg.sms.send({ from_e164, to_e164, message });

cg.integrations.getAgent(agentId);
cg.integrations.updateAgent(agentId, { customer_lookup_url?, customer_lookup_enabled? });
cg.integrations.rotateAgentSecret(agentId);
cg.integrations.getTenant();
cg.integrations.updateTenant(customerLookupUrl);
cg.integrations.rotateTenantSecret();

cg.webhooks.list();
cg.webhooks.create({ url, events, description? });
cg.webhooks.update(id, { url?, events?, description?, is_active? });
cg.webhooks.delete(id);
cg.webhooks.test(id);

cg.numbers.countries();
cg.numbers.available({ country_code, type, contains, locality, limit });
cg.numbers.buy({ e164, country_code?, number_type?, agent_id? });
cg.numbers.list();
cg.numbers.get(id);
cg.numbers.assign(id, agentId);
cg.numbers.unassign(id);
```

### Full white-label number provisioning

Search, buy, and assign a number to an agent — zero-to-working-inbound-number
via the API alone, no dashboard step required:

```ts
const { numbers } = await cg.numbers.available({ country_code: 'AU', type: 'local' });
const pick = numbers[0];

// Real wallet spend — requires the numbers:buy scope IN ADDITION to numbers:read.
const bought = await cg.numbers.buy({
  e164: pick.e164,
  country_code: 'AU',
  number_type: 'local',
  agent_id: 42, // optional — assign immediately on purchase
});

console.log(bought.id, bought.e164, bought.agent_name); // never includes the internal carrier SID
```

Or manage an already-owned number:

```ts
const numbers = await cg.numbers.list();
console.log(numbers.data); // never includes the internal carrier SID

await cg.numbers.assign(17, 42); // inbound calls to number 17 now route to agent 42
await cg.numbers.unassign(17);   // stops routing until reassigned
```

## Verifying webhook signatures

Every webhook delivery — and every `customer_lookup` request — is signed
with `HMAC-SHA256` over the raw request body:

```ts
import { verifyWebhookSignature } from '@audelo/sdk/webhooks';

const isValid = verifyWebhookSignature(
  rawRequestBody,                    // the RAW bytes/string, not a re-parsed object
  req.headers['x-audelo-signature'],
  process.env.AUDELO_WEBHOOK_SECRET! // whsec_... (webhooks) or dlsec_... (customer_lookup)
);
```

See [`examples/webhook-receiver.ts`](./examples/webhook-receiver.ts) for a
complete Express server, including why you need your framework's *raw* body
(not its parsed JSON) to verify correctly.

## Error handling

Every non-2xx response throws a `AudeloApiError`:

```ts
import { AudeloApiError } from '@audelo/sdk';

try {
  await cg.numbers.assign(17, 42);
} catch (err) {
  if (err instanceof AudeloApiError) {
    console.error(err.status, err.error, err.message, err.requestId);
    // e.g. 409 number_already_assigned "This number is already assigned..."
    if (err.status === 429) {
      console.log('Retry after', err.retryAfter, 'seconds');
    }
  }
  throw err;
}
```

`err.error` is the machine-readable code (`validation_error`,
`plan_required`, `number_already_assigned`, etc.) — match on that, not on
`err.message`, which is meant for humans and may change wording over time.
`err.requestId` is worth logging — quote it if you contact Audelo support.

## Rate limits & idempotency

- 300 requests/minute per API key. A `429` includes `err.retryAfter`
  (seconds) parsed from the `Retry-After` header.
- `cg.calls.initiate()` accepts an optional `idempotency_key` (≤64 chars) —
  the same key + same API key within 24h returns the *same* response.
  Don't reuse a key across different agents or phone numbers.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

## License

MIT © Audelo Pty Ltd — see [LICENSE](./LICENSE).
