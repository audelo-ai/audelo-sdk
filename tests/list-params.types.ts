/**
 * Compile-time regression tests for the list-method parameter surfaces.
 *
 * Background (commit 0c1d702): `calls.list({ limit: 3 })` used to type-check, get sent,
 * get ignored by the server, and return all 50 rows — ListCallsParams carried an index
 * signature, so ANY key compiled. `GET /calls`, `GET /agents` and `GET /numbers` are
 * hardcoded to `->paginate(50)` server-side (PublicApiController / NumberController,
 * verified in the handlers); `page` is the only navigation parameter.
 *
 * This file contains no runtime assertions. It is type-checked by `npm run typecheck`
 * (via tsconfig.tests.json, and therefore by `prepublishOnly`): every @ts-expect-error
 * below FAILS THE BUILD if the line under it ever starts compiling again (tsc reports
 * "Unused '@ts-expect-error' directive") — so a regression in either direction, an
 * option quietly returning or a real option quietly vanishing, breaks the publish gate.
 */
import { AudeloClient } from '../src/index.js';

const cg = new AudeloClient({ apiKey: 'cgk_type_test_only' });

// ── positive: the real surface must keep compiling ──────────────────────────────
void cg.calls.list();
void cg.calls.list({ page: 2 });
void cg.calls.list({ agent_id: 61, status: 'completed', from: '2026-08-01', to: '2026-08-19', page: 1 });
void cg.agents.list();
void cg.agents.list(2);
void cg.numbers.list(2);
// numbers.available()'s `limit` is REAL (NumberController validates min:1|max:50,
// default 20) — it must never be removed by analogy with the paginated lists.
void cg.numbers.available({ limit: 5 });
void cg.numbers.available({ country_code: 'AU', type: 'local', contains: '02', limit: 50 });

// ── negative: options the API cannot honour must not type-check ─────────────────
// @ts-expect-error — GET /calls is fixed at 50/page server-side; there is no limit param.
void cg.calls.list({ limit: 3 });
// @ts-expect-error — per_page does not exist either.
void cg.calls.list({ per_page: 10 });
// @ts-expect-error — near-miss typo: the real key is agent_id (snake_case).
void cg.calls.list({ agentId: 61 });
// @ts-expect-error — agents.list takes a bare page number, not an options object.
void cg.agents.list({ limit: 3 });
// @ts-expect-error — numbers.list takes a bare page number, not an options object.
void cg.numbers.list({ limit: 3 });
