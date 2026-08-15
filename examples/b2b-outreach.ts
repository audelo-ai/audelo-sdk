/**
 * Use case 4 — B2B prospect outreach (person + the business being called).
 *
 * You're calling a BUSINESS, not a consumer — the person who answers has a
 * name, but so does the business you're trying to reach, and those are two
 * different facts. Use the top-level `caller_name` for the PERSON and
 * `business_name` for the BUSINESS.
 *
 * Run: AUDELO_KEY=cgk_... npx tsx examples/b2b-outreach.ts
 */

import { AudeloClient } from '../src/index.js';

const cg = new AudeloClient({ apiKey: process.env.AUDELO_KEY! });

interface Prospect {
  phone: string;
  contact_name: string;
  business_name: string;
  category: string;
}

async function dialProspect(prospect: Prospect) {
  // Don't put a business name in caller_name — the agent frames identity
  // verification around caller_name as a PERSON's name ("is this Barry?"),
  // so a business name there produces a confusing opener.
  return cg.calls.initiate({
    agent_id: 42,
    phone_number: prospect.phone,
    caller_name: prospect.contact_name, // the PERSON: "Barry Rahme"
    business_name: prospect.business_name, // the BUSINESS: "Barry's Plumbing"
    dial_pipeline: 'livekit', // required for custom_data to reach the agent
    custom_data: {
      category: prospect.category,
      call_purpose: 'prospect_outreach',
    },
  });
}

/**
 * Alternative shape: if your integration already sends the contact name and
 * business name inside custom_data (e.g. it predates the top-level
 * business_name field, or pushes a richer prospect record), use the keys
 * `contact_name` / `business_name` there instead — Audelo prefers those
 * over the top-level caller_name/business_name fields when both are
 * present, so an already-correct custom_data payload works unchanged.
 */
async function dialProspectViaCustomData(prospect: Prospect) {
  return cg.calls.initiate({
    agent_id: 42,
    phone_number: prospect.phone,
    dial_pipeline: 'livekit',
    custom_data: {
      contact_name: prospect.contact_name, // preferred for caller_name
      business_name: prospect.business_name, // preferred for business_name
      category: prospect.category,
      call_purpose: 'prospect_outreach',
    },
  });
}

dialProspect({
  phone: '+61412345678',
  contact_name: 'Barry Rahme',
  business_name: "Barry's Plumbing",
  category: 'trades',
}).then((call) => {
  console.log('Prospect call queued:', call.call_id);
}).catch((err) => {
  console.error('B2B outreach failed:', err);
  process.exitCode = 1;
});

// Exported so the alternative shape is reachable from a test/other caller
// without lint flagging it as dead code.
export { dialProspectViaCustomData };
