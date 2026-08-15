/**
 * Use case 2 — therapist intake pre-fill (pull, via customer_lookup).
 *
 * A patient books an intake online. You want the agent to greet them by
 * name and reference their stated concerns — but the call could come from
 * EITHER direction (they call in, or the practice calls them back), so
 * push (custom_data) isn't a fit. Use pull instead: enable customer_lookup
 * for the agent and point it at your own intake-lookup endpoint. The agent
 * looks the patient up live, by whatever they say on the call (name, phone
 * number, booking reference) — no pre-staging required.
 *
 * This file is TWO parts: (1) a one-time setup call that configures the
 * lookup URL via the SDK, and (2) the receiving server itself.
 *
 * Setup:  AUDELO_KEY=cgk_... npx tsx examples/therapist-intake.ts setup
 * Serve:  LOOKUP_SECRET=dlsec_... npx tsx examples/therapist-intake.ts serve
 */

import express from 'express';
import { AudeloClient } from '../src/index.js';
import { verifyCustomerLookupSignature } from '../src/webhooks.js';

const AGENT_ID = 12; // the intake agent

async function setup() {
  const cg = new AudeloClient({ apiKey: process.env.AUDELO_KEY! });

  // Point this agent at your own lookup endpoint.
  await cg.integrations.updateAgent(AGENT_ID, {
    customer_lookup_url: 'https://intake.yourclinic.com/audelo/customer-lookup',
    customer_lookup_enabled: true,
  });

  // Get the signing secret — shown exactly once. Store it as LOOKUP_SECRET.
  const { secret } = await cg.integrations.rotateAgentSecret(AGENT_ID);
  console.log('Store this as LOOKUP_SECRET (shown once):', secret);
}

// A stand-in for your real patient store.
interface Patient {
  preferred_name: string;
  pronouns: string;
  concern_brief: string;
  prior_therapy: boolean;
}

async function findByAny(_query: string): Promise<Patient | null> {
  // Look the caller up by whatever identifying detail they gave — name,
  // phone number, or booking reference. Real implementation queries your DB.
  return null;
}

function serve() {
  const LOOKUP_SECRET = process.env.LOOKUP_SECRET!;
  const app = express();

  app.post(
    '/audelo/customer-lookup',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.header('X-Audelo-Signature');
      const rawBody = req.body as Buffer;

      // Signed EXACTLY like a webhook delivery — same HMAC-SHA256 scheme,
      // just with the agent's (or tenant's) dlsec_... secret instead of a
      // webhook's whsec_... one. Reuse the same verification function.
      if (!verifyCustomerLookupSignature(rawBody, signature, LOOKUP_SECRET)) {
        res.status(401).json({ error: 'invalid_signature' });
        return;
      }

      const { query } = JSON.parse(rawBody.toString('utf8')) as { query: string };
      const patient = await findByAny(query);

      if (!patient) {
        res.json({}); // agent gets "nothing on file" — never invents a match
        return;
      }

      // Respond within 8 seconds. The agent states only the exact values
      // returned here — it never estimates, rounds, or invents a field.
      res.json({
        preferred_name: patient.preferred_name,
        pronouns: patient.pronouns,
        presenting_concern: patient.concern_brief,
        prior_therapy: patient.prior_therapy,
      });
    }
  );

  const port = Number(process.env.PORT ?? 3001);
  app.listen(port, () => console.log(`Customer-lookup receiver listening on :${port}`));
}

const mode = process.argv[2];
if (mode === 'setup') {
  setup().catch((err) => {
    console.error('Setup failed:', err);
    process.exitCode = 1;
  });
} else if (mode === 'serve') {
  serve();
} else {
  console.error('Usage: tsx therapist-intake.ts <setup|serve>');
  process.exitCode = 1;
}
