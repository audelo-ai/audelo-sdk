/**
 * Audelo public API client.
 *
 * A thin wrapper around `https://audelo.ai/api/v1/*` — one method per
 * documented endpoint, matching `docs/api/INTEGRATION_GUIDE.md` and
 * `public/llms.txt` in the platform repo exactly (request/response shapes,
 * field names, error codes). Nothing here re-implements platform logic;
 * it only shapes HTTP calls and parses JSON.
 *
 * Requires a global `fetch` (Node 18+, or any modern runtime/bundler —
 * no HTTP client dependency).
 */

const DEFAULT_BASE_URL = 'https://audelo.ai/api/v1';

export interface AudeloClientOptions {
  /** Your `cgk_...` API key, from the dashboard's API Keys page. */
  apiKey: string;
  /** Override the base URL — mainly for local/dev testing against a non-production stack. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30_000. */
  timeoutMs?: number;
}

/**
 * The `{ error, message, request_id, errors? }` envelope every non-2xx
 * response uses. Thrown by every client method on failure — `error` is the
 * machine-readable code (e.g. `number_already_assigned`, `plan_required`,
 * `validation_error`); `errors` is present only on `422` field-validation
 * failures. Always quote `requestId` when contacting Audelo support.
 */
export class AudeloApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly requestId?: string;
  readonly errors?: Record<string, string[]>;
  readonly retryAfter?: number;

  constructor(status: number, body: {
    error?: string;
    message?: string;
    request_id?: string;
    errors?: Record<string, string[]>;
  }, retryAfter?: number) {
    super(body.message ?? `Audelo API request failed with status ${status}`);
    this.name = 'AudeloApiError';
    this.status = status;
    this.error = body.error ?? 'unknown_error';
    this.requestId = body.request_id;
    this.errors = body.errors;
    this.retryAfter = retryAfter;
  }
}

// ── Shared shapes ────────────────────────────────────────────────────────

export interface Paginated<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  next_page_url: string | null;
  prev_page_url: string | null;
  [key: string]: unknown;
}

export interface ToolFlags {
  sms?: boolean;
  web_search?: boolean;
  email?: boolean;
  customer_lookup?: { enabled?: boolean; resolved?: boolean };
}

export interface AgentSummary {
  id: number;
  name: string;
  status: 'active' | 'inactive';
  voice: string;
  language: string;
  voice_engine?: 'xai' | 'deepgram';
  deepgram_voice?: string | null;
  created_at: string;
  updated_at: string;
  tools?: ToolFlags;
}

export interface AgentDetail extends AgentSummary {
  humour_level?: number;
  empathy_level?: number;
  formality_level?: number;
  energy_level?: number;
  directness_level?: number;
}

export type CallDirection = 'inbound' | 'outbound';
export type CallStatus = 'ringing' | 'in_progress' | 'completed' | 'failed' | 'no_answer';

export interface CallSummaryRow {
  id: number;
  agent_id: number;
  from_e164: string;
  to_e164: string;
  direction: CallDirection;
  status: string;
  duration_sec: number;
  created_at: string;
}

export interface CallDetail {
  id: number;
  agent: { id: number; name: string };
  from_e164: string;
  to_e164: string;
  direction: CallDirection;
  status: string;
  duration_sec: number;
  summary?: string | null;
  recording_url?: string | null;
  created_at: string;
  [key: string]: unknown;
}

/**
 * Query parameters for `calls.list()`.
 *
 * Deliberately a `type`, not an `interface`, and deliberately WITHOUT an index signature.
 * The index signature this replaced accepted any string key and forwarded it to the query
 * string, so `calls.list({ limit: 3 })` type-checked, was sent, was ignored by the server,
 * and returned all 50 rows — a typed client advertising an option it cannot honour, which is
 * worse than an untyped fetch because the type invites trust. `GET /calls` and `GET /agents`
 * are fixed at `->paginate(50)` server-side (verified in PublicApiController, not inferred);
 * `page` is the only navigation parameter, and it is right here.
 *
 * The same signature also silently swallowed near-miss typos — `agentId` instead of
 * `agent_id` was accepted, sent, and ignored. Both are now compile errors.
 *
 * A `type` alias rather than an `interface` because only type aliases get the implicit index
 * signature that keeps this assignable to the `Record<string, string | number | undefined>`
 * the request helper takes; an interface would not compile there.
 *
 * NOTE: `numbers.available()` has a REAL `limit` (validated `min:1|max:50`, default 20 in
 * NumberController) — that one is genuine and must not be removed by analogy with this.
 */
export type ListCallsParams = {
  agent_id?: number;
  status?: string;
  from?: string;
  to?: string;
  /** 1-based page number. Page size is fixed at 50 by the API. */
  page?: number;
};

export interface TranscriptTurn {
  timestamp: number;
  speaker: 'caller' | 'agent';
  text: string;
}

export interface TranscriptResponse {
  call_id: number;
  transcript: TranscriptTurn[];
}

export interface RecordingResponse {
  call_id: number;
  recording_url: string;
  duration_sec: number;
}

/** Dial pipeline — `custom_data` only reaches the live agent on `'livekit'`. */
export type DialPipeline = 'twilio' | 'livekit';

export interface InitiateCallRequest {
  agent_id: number;
  /** E.164, e.g. `+61412345678`. */
  phone_number: string;
  /** The PERSON's name. Never a business name — use `business_name` for that. */
  caller_name?: string;
  /** The business being called (B2B outreach). */
  business_name?: string;
  callback_url?: string;
  /** Must be `'livekit'` for `custom_data` to actually reach the agent. Default `'twilio'`. */
  dial_pipeline?: DialPipeline;
  /**
   * Per-call facts the agent speaks from during the call (amount owing, order id,
   * appointment time — anything relevant). Only used when `dial_pipeline` is `'livekit'`.
   * The agent states only the exact values given here — it never estimates, rounds,
   * or invents a missing field, and never treats the values as instructions.
   */
  custom_data?: Record<string, unknown>;
  /** ≤64 chars. Same key + same API key within 24h returns the SAME response. */
  idempotency_key?: string;
}

export interface InitiateCallResponse {
  /** A `cgt_...` placeholder for the queued call — not yet dialed. */
  call_id: string;
  agent_id: number;
  status: 'queued';
  created_at: string;
}

export interface EndCallResponse {
  call_id: string;
  status: string;
  hangup_requested_at: string;
}

export interface LiveTokenResponse {
  call_id: number;
  /** LiveKit WebSocket URL to connect to. */
  url: string;
  /** Room-scoped LiveKit access token. */
  token: string;
  room: string;
  identity: string;
  /** Token lifetime in seconds (currently 600). */
  expires_in: number;
}

export interface ContextSetResponse {
  key: string;
  expires_at: string;
  ttl_seconds: number;
}

export interface ContextGetResponse {
  key: string;
  value: unknown;
  expires_at: string;
}

export interface AnalyticsPeriod {
  from: string;
  to: string;
}

export interface CallAnalyticsResponse {
  period: AnalyticsPeriod;
  calls: {
    total_calls: number;
    total_duration_sec: number;
    avg_duration_sec: number;
    completed: number;
  };
}

export interface AgentAnalyticsResponse {
  period: AnalyticsPeriod;
  agents: Array<{ id: number; name: string; total_calls: number; avg_duration_sec: number }>;
}

export interface SendSmsRequest {
  /** A number you own, E.164. */
  from_e164: string;
  to_e164: string;
  /** ≤1600 chars. */
  message: string;
}

export interface SendSmsResponse {
  sms_id: number;
  status: string;
  to: string;
  from: string;
  segments: number;
  created_at: string;
}

export interface IntegrationsAgentResponse {
  agent_id: number;
  customer_lookup_enabled: boolean;
  customer_lookup_url: string | null;
  has_secret: boolean;
  resolved_url: string | null;
  resolved_source: 'agent' | 'tenant' | null;
}

export interface UpdateAgentIntegrationsRequest {
  customer_lookup_url?: string | null;
  customer_lookup_enabled?: boolean;
}

export interface IntegrationsSecretResponse {
  agent_id: number;
  secret: string;
  message: string;
}

export interface IntegrationsTenantResponse {
  tenant_id: number;
  customer_lookup_url: string | null;
  has_secret: boolean;
}

export interface IntegrationsTenantSecretResponse {
  tenant_id: number;
  secret: string;
  message: string;
  affected_agents: Array<{ id: number; name: string }>;
}

export type WebhookEventName =
  | 'call.started'
  | 'call.ended'
  | 'call.transcript'
  | 'booking.created'
  | 'lead.captured'
  | 'call.summary.ready'
  | 'sms.received';

export interface WebhookEndpoint {
  id: number;
  url: string;
  description?: string | null;
  events: WebhookEventName[];
  is_active: boolean;
  failure_count: number;
  created_at: string;
}

export interface CreateWebhookRequest {
  url: string;
  description?: string;
  events: WebhookEventName[];
}

export interface CreateWebhookResponse extends WebhookEndpoint {
  /** Shown exactly once. Store it — it cannot be retrieved again, only rotated. */
  secret: string;
}

export interface UpdateWebhookRequest {
  url?: string;
  description?: string;
  events?: WebhookEventName[];
  is_active?: boolean;
}

export interface WebhookTestResponse {
  delivery_id: number;
  status: string;
  response_code: number | null;
  delivered_at: string | null;
}

/** The event envelope Audelo POSTs to a registered webhook URL. */
export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  event: WebhookEventName;
  timestamp: string;
  data: T;
}

export interface PhoneNumberSummary {
  id: number;
  e164: string;
  country_code: string | null;
  capabilities: Record<string, boolean> | null;
  agent_id: number | null;
  /** `null` when the number isn't assigned to an agent. */
  agent_name: string | null;
  created_at: string;
}

export interface CountryInfo {
  name: string;
  calling_code: string;
  flag: string;
  phase: number;
  available_types: Array<'local' | 'mobile' | 'toll_free'>;
}

/** `{ AU: {...}, GB: {...}, ... }` — keyed by 2-letter ISO code. */
export type CountriesResponse = Record<string, CountryInfo>;

export type NumberType = 'local' | 'mobile' | 'toll_free';

export interface SearchAvailableNumbersParams {
  /** 2-letter ISO code, default `'AU'`. */
  country_code?: string;
  type?: NumberType;
  /** Digits/letters to match within the number. */
  contains?: string;
  locality?: string;
  /** Max 50. */
  limit?: number;
  capabilities?: Array<'voice' | 'sms' | 'mms' | 'fax'>;
}

export interface AvailableNumber {
  e164: string;
  friendly: string;
  locality: string | null;
  capabilities: Record<string, boolean>;
  country_code: string;
  type: NumberType;
  monthly_cost_cents: number;
  [key: string]: unknown;
}

export interface SearchAvailableNumbersResponse {
  numbers: AvailableNumber[];
  /** Present when Twilio has no inventory for that country/type — `numbers` is `[]`, not an error. */
  warning?: string;
}

export interface BuyNumberRequest {
  /** The exact number to buy, from a `numbers.available()` search result. */
  e164: string;
  /** 2-letter ISO code, default `'AU'`. */
  country_code?: string;
  /** Default `'local'`. */
  number_type?: NumberType;
  /** Assign the number to this agent immediately on purchase. */
  agent_id?: number;
}

// ── Client ───────────────────────────────────────────────────────────────

export class AudeloClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: AudeloClientOptions) {
    if (!options.apiKey || !options.apiKey.startsWith('cgk_')) {
      throw new Error('AudeloClient requires a valid apiKey (starts with "cgk_").');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const retryAfterHeader = res.headers.get('Retry-After');
      throw new AudeloApiError(
        res.status,
        json,
        retryAfterHeader ? Number(retryAfterHeader) : undefined
      );
    }

    return json as T;
  }

  // ── Agents (scope: agents:read) ───────────────────────────────────────

  agents = {
    /** `GET /agents` — paginated, 50/page, ordered by name. */
    list: (page?: number) =>
      this.request<Paginated<AgentSummary>>('GET', '/agents', { query: { page } }),

    /** `GET /agents/{id}` — 404 if it isn't in your account. */
    get: (id: number | string) => this.request<AgentDetail>('GET', `/agents/${id}`),
  };

  // ── Calls (scope: calls:read / calls:write, calls:write requires Pro) ──

  calls = {
    /** `GET /calls` — paginated, newest first. */
    list: (params: ListCallsParams = {}) =>
      this.request<Paginated<CallSummaryRow>>('GET', '/calls', { query: params }),

    /** `GET /calls/{id}` — includes the AI summary and recording link once available. */
    get: (id: number | string) => this.request<CallDetail>('GET', `/calls/${id}`),

    /** `GET /calls/{id}/transcript` — ordered turns, `timestamp` = ms offset from call start. */
    transcript: (id: number | string) =>
      this.request<TranscriptResponse>('GET', `/calls/${id}/transcript`),

    /** `GET /calls/{id}/recording` — 404 if the call has no recording. */
    recording: (id: number | string) =>
      this.request<RecordingResponse>('GET', `/calls/${id}/recording`),

    /**
     * `POST /calls/initiate` (scope `calls:write`, **Pro plan**) — place an outbound call.
     * Runs through your DNC list, calling-hours, and max-concurrent caps server-side.
     * Returns `202 Accepted` with a `cgt_...` placeholder call_id — use it with `.end()`,
     * or correlate it against `data.outbound_target_id` on the webhooks that follow.
     */
    initiate: (body: InitiateCallRequest) =>
      this.request<InitiateCallResponse>('POST', '/calls/initiate', { body }),

    /**
     * `POST /calls/{id}/end` (scope `calls:write`, **Pro plan**) — hang up an in-progress
     * call. `id` may be numeric or a `cgt_...` placeholder. Idempotent for ended calls.
     */
    end: (id: number | string) => this.request<EndCallResponse>('POST', `/calls/${id}/end`),

    /**
     * `POST /calls/{id}/listen` (scope `calls:listen`, **Pro plan**) — mints a short-lived,
     * listen-only LiveKit token for an in-progress LiveKit-pipeline call. Connect with
     * `livekit-client` and subscribe to the audio tracks. Request a fresh token once
     * `expires_in` elapses. Throws `AudeloApiError` with `error: 'unsupported_pipeline'`
     * for classic-pipeline calls, `'call_not_active'` for ended calls.
     */
    listen: (id: number | string) =>
      this.request<LiveTokenResponse>('POST', `/calls/${id}/listen`),

    /**
     * `POST /calls/{id}/takeover` (scope `calls:takeover`, **Pro plan**) — silences the AI
     * agent on an in-progress OUTBOUND call and mints a token that can publish microphone
     * audio, so a human speaks to the caller directly. Optional `handoverText` (≤200 chars)
     * is spoken by the agent verbatim before it goes silent. Disconnect any `.listen()`
     * connection once this one is up, or every track plays twice.
     */
    takeover: (id: number | string, handoverText?: string) =>
      this.request<LiveTokenResponse>('POST', `/calls/${id}/takeover`, {
        body: handoverText ? { handover_text: handoverText } : {},
      }),
  };

  // ── Context store (scope: calls:read / calls:write, requires Pro) ─────

  context = {
    /** `POST /context/{key}` — TTL defaults to 86400s (24h), max 2592000 (30 days). */
    set: (key: string, value: unknown, ttlSeconds?: number) =>
      this.request<ContextSetResponse>('POST', `/context/${encodeURIComponent(key)}`, {
        body: { value, ...(ttlSeconds !== undefined ? { ttl_seconds: ttlSeconds } : {}) },
      }),

    /** `GET /context/{key}` — 404 if expired or missing. */
    get: (key: string) =>
      this.request<ContextGetResponse>('GET', `/context/${encodeURIComponent(key)}`),

    /** `DELETE /context/{key}` — idempotent, always 204 whether or not it existed. */
    delete: (key: string) =>
      this.request<void>('DELETE', `/context/${encodeURIComponent(key)}`),
  };

  // ── Analytics (scope: analytics:read) ──────────────────────────────────

  analytics = {
    /** `GET /analytics/calls` — aggregate stats for a window (default last 30 days). */
    calls: (from?: string, to?: string) =>
      this.request<CallAnalyticsResponse>('GET', '/analytics/calls', { query: { from, to } }),

    /** `GET /analytics/agents` — per-agent breakdown for a window (default last 30 days). */
    agents: (from?: string, to?: string) =>
      this.request<AgentAnalyticsResponse>('GET', '/analytics/agents', { query: { from, to } }),
  };

  // ── SMS (scope: sms:write) ──────────────────────────────────────────────

  sms = {
    /**
     * `POST /sms/send` — a one-off transactional send from a number you own. NOT the
     * live-call `send_sms` tool and NOT an SMS campaign; no "Reply STOP" marketing
     * framing is added — this is for account notices/confirmations/OTPs, not marketing.
     */
    send: (body: SendSmsRequest) =>
      this.request<SendSmsResponse>('POST', '/sms/send', { body }),
  };

  // ── Integrations / customer_lookup config (scope: integrations:read/write) ──

  integrations = {
    /** `GET /agents/{id}/integrations` */
    getAgent: (agentId: number | string) =>
      this.request<IntegrationsAgentResponse>('GET', `/agents/${agentId}/integrations`),

    /** `PUT /agents/{id}/integrations` — partial update; omit a field to leave it unchanged. */
    updateAgent: (agentId: number | string, body: UpdateAgentIntegrationsRequest) =>
      this.request<IntegrationsAgentResponse>('PUT', `/agents/${agentId}/integrations`, { body }),

    /** `POST /agents/{id}/integrations/secret` — rotates this agent's OWN secret. Shown once. */
    rotateAgentSecret: (agentId: number | string) =>
      this.request<IntegrationsSecretResponse>('POST', `/agents/${agentId}/integrations/secret`),

    /** `GET /integrations` — the tenant-wide default `customer_lookup` config. */
    getTenant: () => this.request<IntegrationsTenantResponse>('GET', '/integrations'),

    /** `PUT /integrations` — body key is required; pass `null` to clear the URL. */
    updateTenant: (customerLookupUrl: string | null) =>
      this.request<IntegrationsTenantResponse>('PUT', '/integrations', {
        body: { customer_lookup_url: customerLookupUrl },
      }),

    /**
     * `POST /integrations/secret` — rotates the tenant-wide secret. `affected_agents`
     * lists every agent currently inheriting this URL (enabled, no URL of its own) —
     * exactly the agents whose requests you need to re-verify against the new secret.
     */
    rotateTenantSecret: () =>
      this.request<IntegrationsTenantSecretResponse>('POST', '/integrations/secret'),
  };

  // ── Webhooks (scope: webhooks:manage) ───────────────────────────────────

  webhooks = {
    /** `GET /webhooks` — max 20 endpoints per account. */
    list: () => this.request<{ data: WebhookEndpoint[] }>('GET', '/webhooks'),

    /** `POST /webhooks` — `secret` (`whsec_...`) is returned once; store it immediately. */
    create: (body: CreateWebhookRequest) =>
      this.request<CreateWebhookResponse>('POST', '/webhooks', { body }),

    /** `PUT /webhooks/{id}` — re-activating (`is_active: true`) resets the failure count. */
    update: (id: number | string, body: UpdateWebhookRequest) =>
      this.request<WebhookEndpoint>('PUT', `/webhooks/${id}`, { body }),

    /** `DELETE /webhooks/{id}` */
    delete: (id: number | string) => this.request<void>('DELETE', `/webhooks/${id}`),

    /** `POST /webhooks/{id}/test` — fires a synchronous test delivery. */
    test: (id: number | string) =>
      this.request<WebhookTestResponse>('POST', `/webhooks/${id}/test`),
  };

  // ── Phone numbers (scope: numbers:read / numbers:write) ────────────────

  numbers = {
    /** `GET /numbers/countries` — countries currently purchasable (Phase 1 markets). */
    countries: () => this.request<CountriesResponse>('GET', '/numbers/countries'),

    /**
     * `GET /numbers/available` — search Twilio's inventory for numbers to buy. If no
     * inventory exists for that country/type, resolves with `{ numbers: [], warning }`
     * rather than throwing.
     */
    available: (params: SearchAvailableNumbersParams = {}) =>
      this.request<SearchAvailableNumbersResponse>('GET', '/numbers/available', {
        query: {
          country_code: params.country_code,
          type: params.type,
          contains: params.contains,
          locality: params.locality,
          limit: params.limit,
        },
      }),

    /**
     * `POST /numbers` — buy a brand-new number. Real wallet spend: requires the
     * `numbers:buy` scope IN ADDITION TO `numbers:read` on your API key. Throws
     * `AudeloApiError` with `error: 'insufficient_credit'` (402, `requiredCents`/
     * `availableCents` on the response body) if the wallet can't cover at least one
     * month's wholesale cost, or `'purchase_failed'` (422) if a required regulatory
     * bundle isn't set up. `agentId`, if given, assigns the number immediately.
     */
    buy: (body: BuyNumberRequest) =>
      this.request<PhoneNumberSummary>('POST', '/numbers', { body }),

    /**
     * `GET /numbers` — paginated, this business's numbers only. Never includes the
     * internal Twilio SID.
     */
    list: (page?: number) =>
      this.request<Paginated<PhoneNumberSummary>>('GET', '/numbers', { query: { page } }),

    /** `GET /numbers/{id}` — 404 if the id isn't in your account. */
    get: (id: number | string) =>
      this.request<PhoneNumberSummary>('GET', `/numbers/${id}`),

    /**
     * `POST /numbers/{id}/assign` — inbound calls to this number now route to `agentId`.
     * Re-assigning to the SAME agent already on the number is a harmless no-op. Throws
     * `AudeloApiError` with `error: 'number_already_assigned'` (409) if it's on a
     * *different* agent — call `.unassign()` first — or `'agent_tenant_mismatch'` (422)
     * if `agentId` isn't an agent in your account.
     */
    assign: (id: number | string, agentId: number) =>
      this.request<PhoneNumberSummary>('POST', `/numbers/${id}/assign`, {
        body: { agent_id: agentId },
      }),

    /**
     * `POST /numbers/{id}/unassign` — clears inbound routing for this number. A no-op
     * if it wasn't assigned to begin with.
     */
    unassign: (id: number | string) =>
      this.request<PhoneNumberSummary>('POST', `/numbers/${id}/unassign`),
  };
}
