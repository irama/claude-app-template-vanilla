/**
 * Jev classifier client — the GOLDEN TypeScript copy.
 *
 * Jev is a System One model: it returns a typed value with a calibrated confidence instead of
 * prose a program has to parse. Use it as the cheap first tier of a classifier cascade and send
 * only the low-confidence cases to an expensive model or to a person. The pattern, and when it
 * is the wrong tool, is in `docs/classifier-cascade.md`.
 *
 * This file is VENDORED. Every repo that uses Jev holds a byte-identical copy at `lib/jev.ts`.
 * There is no package. Edit the golden copy in the seed app template, copy it out again, and
 * run `scripts/jev-sync.py --update` there so the checksum manifest matches. Never edit a
 * vendored copy in place: `scripts/jev-sync.py` will report it as drift.
 *
 * No dependencies. Platform fetch and AbortController only.
 *
 * Usage:
 *
 *     const result = await askJev(
 *       { subject: 'Invoice 4021', body: '...' },
 *       {
 *         is_spam: { type: 'noul', instructions: 'The message is unsolicited bulk mail.' },
 *         kind: {
 *           type: 'choice',
 *           instructions: 'Classify the message.',
 *           criteria: { spam: 'Unsolicited.', work: 'Professional.' },
 *         },
 *       },
 *       { appUrl: 'https://example.tld', appName: 'Example' },
 *     );
 *     if (result === null) {
 *       // Shadow mode is off. Nothing was sent. Use the existing rule.
 *     }
 *
 * The seven traps below were each found by a failing live call, not by reading documentation.
 * The client enforces the first five so a caller gets a local error instead of an HTTP 400 or,
 * worse, a plausible wrong answer.
 *
 *  1. The field is `instructions`, never `question`. `question` returns HTTP 400.
 *  2. `choice` requires `criteria` as an object of option name to description.
 *  3. `score` requires `criteria` as an array of anchor descriptions.
 *  4. `noul` takes no `criteria`, and its answer carries NO confidence field. Threshold a noul
 *     on the probability itself, with a band around 0.5 as the uncertain zone. See noulVerdict.
 *  5. There is no per-row iteration. An `each` key is silently ignored and one answer comes back
 *     for the whole batch, which looks like a working call and is not. Batch by emitting many
 *     NAMED questions over one shared state.
 *  6. Jev is absent from OpenRouter's public `/api/v1/models` list. Never probe for it there.
 *  7. The response carries the resolved dated model (`typesafe/jev-1.13-20260917`). Record that,
 *     never the request alias.
 *
 * Provider routing is sent on every call. `data_collection: 'deny'` excludes any upstream
 * provider that trains on or retains prompts, so retention is a decision this code makes rather
 * than whatever the OpenRouter account default happens to be. Pass `provider: null` to send no
 * block at all, and read `JEV_DEFAULT_PROVIDER_ROUTING` below before you do.
 */

export const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_DEFAULT_MODEL = 'typesafe/jev-1.13';

/** A question to ask. The key it is filed under is its name, and the answer comes back under it. */
export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type JevQuestions = Record<string, JevQuestion>;

/**
 * OpenRouter provider routing, sent as the request's `provider` block.
 *
 * Verified live against the alpha decisions endpoint on 2026-09-20: the block is accepted, and
 * `provider.only` naming no serving provider comes back HTTP 404, which is how we know the
 * preference is read rather than ignored. An unknown FIELD inside the block is accepted with a
 * 200, so acceptance of `zdr` is not proof that zero data retention was applied.
 */
export interface JevProviderRouting {
  /** 'deny' excludes every upstream provider that trains on or retains prompts. */
  data_collection?: 'deny' | 'allow';
  /** Still move between providers that satisfy the constraints, rather than fail the call. */
  allow_fallbacks?: boolean;
  /** Opt in to zero-data-retention providers only. Accepted by the endpoint; enforcement unverified. */
  zdr?: boolean;
  order?: string[];
  only?: string[];
  ignore?: string[];
}

/**
 * The policy every call carries unless the caller names another one.
 *
 * Deny is the default because a classifier cascade sends the app's private content to this
 * boundary, and the cheap tier sees the same text the expensive tier would.
 */
export const JEV_DEFAULT_PROVIDER_ROUTING: JevProviderRouting = {
  data_collection: 'deny',
  allow_fallbacks: true,
};

/** A noul is a bare probability. It has no confidence field. See trap 4. */
export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: 'score';
  score: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence: number;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export interface JevResult {
  /** The RESOLVED dated model from the response, never the request alias. Record this. */
  model: string;
  answers: Record<string, JevAnswer>;
  usage: JevUsage | null;
  provider: string | null;
  latencyMs: number;
}

export type JevErrorKind =
  | 'disabled'
  | 'not-configured'
  | 'request-invalid'
  | 'response-invalid'
  | 'incomplete'
  | 'http'
  | 'provider-policy-rejected'
  | 'timeout'
  | 'network'
  | 'circuit-open';

/**
 * Every failure mode of the client. A caller catches this and falls back to the code Jev was
 * proposed to replace. The fallback is never optional: this endpoint is alpha.
 */
export class JevError extends Error {
  readonly kind: JevErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    kind: JevErrorKind,
    message: string,
    opts: { status?: number | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'JevError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

export interface JevOptions {
  /** Defaults to env.OPENROUTER_API_KEY. */
  apiKey?: string;
  /** Sent as http-referer, so OpenRouter attributes the spend to this app. */
  appUrl?: string;
  /** Sent as x-title. Attribution, never enforcement: the spend bound is a capped sub-key. */
  appName?: string;
  model?: string;
  /**
   * Provider routing for THIS call. Omit for JEV_DEFAULT_PROVIDER_ROUTING, which denies data
   * collection. Pass null to send no provider block, which hands retention back to the account
   * default: only a caller sending nothing private should do that.
   */
  provider?: JevProviderRouting | null;
  timeoutMs?: number;
  /**
   * The wall-clock budget for the whole call, retries and backoff waits included. Defaults to
   * timeoutMs multiplied by maxAttempts. Every attempt's timeout is clamped to what is left of
   * the budget, an attempt with nothing left is refused, and a wait that would outlive the budget
   * is refused, so a generous Retry-After or a slow provider produces a recorded Jev error
   * instead of a platform timeout.
   */
  budgetMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Set true to run even when JEV_SHADOW_ENABLED is off. Only a deliberate live probe does this. */
  ignoreShadowFlag?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** A caller abort, honoured alongside the client's own timeout. */
  signal?: AbortSignal;
  /**
   * Which circuit breaker this call belongs to. Defaults to a fingerprint of the API key, so one
   * tenant's failures never open the breaker on another's. Name a scope when several callers
   * share one key and you want them isolated, or when one caller uses several keys and you want
   * them counted together.
   */
  circuitScope?: string;
}

/**
 * The kill switch, deliberately independent of OPENROUTER_API_KEY.
 *
 * Several apps reach their EXISTING model through the same OpenRouter key, so removing the key
 * would disable the fallback as well and prove nothing. Fault injection targets Jev alone.
 */
export function jevShadowEnabled(env: Record<string, string | undefined> = readEnv()): boolean {
  const raw = (env.JEV_SHADOW_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * A noul answers a condition with a probability and NO confidence, so the uncertain zone is a
 * band around 0.5 rather than a confidence floor. See trap 4.
 */
export function noulVerdict(
  probability: number,
  band = 0.15,
): 'true' | 'false' | 'uncertain' {
  if (probability >= 0.5 + band) return 'true';
  if (probability <= 0.5 - band) return 'false';
  return 'uncertain';
}

/** The confidence of an answer, or null for a noul, which never carries one. */
export function jevConfidence(answer: JevAnswer): number | null {
  return answer.type === 'noul' ? null : answer.confidence;
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

interface CircuitEntry {
  failures: number;
  openedAt: number;
}

/**
 * One breaker per credential, or per caller-supplied scope.
 *
 * A module-global breaker counted every caller's failures together, so five revoked keys
 * belonging to five different users opened it and cost everyone else a 60-second `circuit-open`.
 * The breaker exists to stop a DEAD ENDPOINT costing a timeout per item, so it is keyed by the
 * credential and only shared failures reach it. See isSharedCircuitFailure.
 */
const circuits = new Map<string, CircuitEntry>();

/**
 * The key a breaker is stored under. A raw credential is never used as the key: a 32-bit FNV-1a
 * fingerprint plus the length tells two keys apart, which is all the breaker needs.
 */
function circuitKey(apiKey: string, scope?: string): string {
  if (scope) return `scope:${scope}`;
  let hash = 2166136261;
  for (let i = 0; i < apiKey.length; i += 1) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `key:${(hash >>> 0).toString(36)}:${apiKey.length}`;
}

function circuitFor(key: string): CircuitEntry {
  let entry = circuits.get(key);
  if (!entry) {
    entry = { failures: 0, openedAt: 0 };
    circuits.set(key, entry);
  }
  return entry;
}

function circuitIsOpen(entry: CircuitEntry | undefined, now: () => number): boolean {
  if (!entry) return false;
  return (
    entry.failures >= CIRCUIT_FAILURE_THRESHOLD && now() - entry.openedAt < CIRCUIT_COOLDOWN_MS
  );
}

/**
 * Only a failure every caller would share may open a breaker.
 *
 * A 400 is one caller's malformed request and a 401 or 403 is one caller's credential. Counting
 * either one punishes every other caller for a fault they cannot see and cannot fix.
 */
function isSharedCircuitFailure(error: JevError): boolean {
  if (error.kind === 'network' || error.kind === 'timeout') return true;
  return error.kind === 'http' && (error.status === 429 || (error.status ?? 0) >= 500);
}

/**
 * Tests and a deliberate manual recovery use this. Nothing in normal operation does.
 *
 * With no scope it clears every breaker. Pass the caller scope to clear just that one.
 */
export function resetJevCircuit(scope?: string): void {
  if (scope === undefined) {
    circuits.clear();
    return;
  }
  circuits.delete(`scope:${scope}`);
}

/**
 * The breaker state for one caller scope, or, with no scope, whether ANY breaker is open. The
 * no-scope form is for monitoring: it never decides whether a call goes out.
 */
export function jevCircuitState(
  now: () => number = Date.now,
  scope?: string,
): 'closed' | 'open' {
  if (scope !== undefined) {
    return circuitIsOpen(circuits.get(`scope:${scope}`), now) ? 'open' : 'closed';
  }
  for (const entry of circuits.values()) {
    if (circuitIsOpen(entry, now)) return 'open';
  }
  return 'closed';
}

// ---------------------------------------------------------------------------
// Request validation — traps 1 to 5
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reject locally what the endpoint rejects with a 400, plus the one it accepts and gets wrong.
 * Exported so a caller can check a question set it built at startup rather than in production.
 */
export function validateJevQuestions(questions: JevQuestions): void {
  if (!isPlainObject(questions)) {
    throw new JevError('request-invalid', 'questions must be an object of name to question.');
  }
  const names = Object.keys(questions);
  if (names.length === 0) {
    throw new JevError('request-invalid', 'questions is empty.');
  }
  for (const name of names) {
    // Trap 5: `each` is silently ignored and yields one answer for the whole batch.
    if (name === 'each') {
      throw new JevError(
        'request-invalid',
        'There is no per-row iteration. An "each" key is ignored and returns a single answer for ' +
          'the whole batch. Emit one named question per row over a shared state instead.',
      );
    }
    const q = questions[name] as unknown;
    if (!isPlainObject(q)) {
      throw new JevError('request-invalid', `Question "${name}" must be an object.`);
    }
    // Trap 1: the field is `instructions`. `question` returns HTTP 400.
    if ('question' in q) {
      throw new JevError(
        'request-invalid',
        `Question "${name}" carries a "question" field. The field is "instructions"; ` +
          '"question" returns HTTP 400.',
      );
    }
    if (typeof q.instructions !== 'string' || q.instructions.trim() === '') {
      throw new JevError(
        'request-invalid',
        `Question "${name}" needs a non-empty "instructions" string.`,
      );
    }
    switch (q.type) {
      case 'noul':
        // Trap 4: noul takes no criteria.
        if ('criteria' in q) {
          throw new JevError(
            'request-invalid',
            `Question "${name}" is a noul and must not carry "criteria".`,
          );
        }
        break;
      case 'choice': {
        // Trap 2: choice requires criteria as an object of option name to description.
        const criteria = q.criteria;
        if (!isPlainObject(criteria) || Object.keys(criteria).length < 2) {
          throw new JevError(
            'request-invalid',
            `Question "${name}" is a choice and needs "criteria" as an object of at least two ` +
              'option names to descriptions. Omitting it returns HTTP 400.',
          );
        }
        for (const [option, description] of Object.entries(criteria)) {
          if (typeof description !== 'string' || description.trim() === '') {
            throw new JevError(
              'request-invalid',
              `Choice "${name}" option "${option}" needs a non-empty description.`,
            );
          }
        }
        break;
      }
      case 'score': {
        // Trap 3: score requires criteria as an ARRAY of anchor descriptions.
        const criteria = q.criteria;
        if (!Array.isArray(criteria) || criteria.length < 2) {
          throw new JevError(
            'request-invalid',
            `Question "${name}" is a score and needs "criteria" as an array of at least two ` +
              'anchor descriptions. Omitting it returns HTTP 400.',
          );
        }
        for (const anchor of criteria) {
          if (typeof anchor !== 'string' || anchor.trim() === '') {
            throw new JevError('request-invalid', `Score "${name}" has an empty anchor.`);
          }
        }
        break;
      }
      default:
        throw new JevError(
          'request-invalid',
          `Question "${name}" has type "${String(q.type)}". Use noul, choice or score.`,
        );
    }
  }
}

// ---------------------------------------------------------------------------
// Response validation — completeness, and trap 7
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The option names a question declared, or null for a noul, which declares none.
 *
 * A `choice` declares its options as the KEYS of its criteria object. A `score` declares its
 * anchors as an array, and the endpoint reports them back by their INDEX as a string, so "0" and
 * "1" are the declared names for a two-anchor score. Both are the taxonomy the answer must stay
 * inside.
 */
function declaredOptions(question: JevQuestion): Set<string> | null {
  if (question.type === 'choice') return new Set(Object.keys(question.criteria));
  if (question.type === 'score') return new Set(question.criteria.map((_, index) => String(index)));
  return null;
}

/**
 * A map of declared option names to probabilities, or a response-validation error.
 *
 * The KEYS and the VALUES both matter, and the client is the only place that can check either,
 * because it is the only place holding the question definitions the caller passed in. A key
 * outside the declared option set is content the model invented, and a value that is not a
 * probability is content too. Both are refused here, where the answer is still refusable, rather
 * than stripped later by a downstream whitelist that may not be looking.
 */
function numberMap(
  name: string,
  field: string,
  value: Record<string, unknown>,
  allowed: Set<string>,
) {
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key)) {
      throw new JevError(
        'response-invalid',
        `Answer "${name}" has a "${field}" key "${key}" that is not a declared option of that ` +
          `question. The declared options are: ${[...allowed].join(', ')}.`,
      );
    }
    if (!finiteNumber(entry) || entry < 0 || entry > 1) {
      throw new JevError(
        'response-invalid',
        `Answer "${name}" has a "${field}" value for "${key}" that is not a finite number in ` +
          '0 to 1. Anything else is content, and the answer is refused rather than cleaned.',
      );
    }
    out[key] = entry;
  }
  return out;
}

/** A map of declared option names to non-empty strings, or a response-validation error. */
function stringMap(
  name: string,
  field: string,
  value: Record<string, unknown>,
  allowed: Set<string>,
) {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key)) {
      throw new JevError(
        'response-invalid',
        `Answer "${name}" has a "${field}" key "${key}" that is not a declared anchor of that ` +
          `question. The declared anchors are: ${[...allowed].join(', ')}.`,
      );
    }
    if (typeof entry !== 'string' || entry === '') {
      throw new JevError(
        'response-invalid',
        `Answer "${name}" has a "${field}" value for "${key}" that is not a non-empty string.`,
      );
    }
    out[key] = entry;
  }
  return out;
}

/**
 * The usage block, or null. Never a cast.
 *
 * Usage is metadata a caller records as cost, so a string where a number belongs must not reach a
 * spend record. It is also not load-bearing, so a shape this client does not recognise reads as
 * "no usage reported" rather than failing the whole call.
 */
function validateUsage(value: unknown): JevUsage | null {
  if (!isPlainObject(value)) return null;
  if (
    !finiteNumber(value.input_tokens) ||
    !finiteNumber(value.output_tokens) ||
    !finiteNumber(value.cost)
  ) {
    return null;
  }
  return {
    input_tokens: value.input_tokens,
    output_tokens: value.output_tokens,
    cost: value.cost,
  };
}

/**
 * One answer, checked against the QUESTION that asked for it, not merely against its own shape.
 *
 * The client holds the question definitions because the caller passed them, so it is the one
 * place that can tell a declared option from an invented one. Every choice, every probability
 * key and every legend key must name something the question declared, and every probability,
 * score, noul and confidence must be a finite number in 0 to 1. An answer outside the declared
 * taxonomy is a `response-invalid` error here; it is never something a downstream whitelist
 * strips after the fact.
 */
function validateAnswer(name: string, question: JevQuestion, raw: unknown): JevAnswer {
  if (!isPlainObject(raw)) {
    throw new JevError('response-invalid', `Answer "${name}" is not an object.`);
  }
  const expected = question.type;
  if (raw.type !== expected) {
    throw new JevError(
      'response-invalid',
      `Answer "${name}" is type "${String(raw.type)}" but "${expected}" was asked.`,
    );
  }
  if (question.type === 'noul') {
    if (!finiteNumber(raw.noul) || raw.noul < 0 || raw.noul > 1) {
      throw new JevError('response-invalid', `Answer "${name}" has no probability in 0 to 1.`);
    }
    return { type: 'noul', noul: raw.noul };
  }
  if (!finiteNumber(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    throw new JevError('response-invalid', `Answer "${name}" has no confidence in 0 to 1.`);
  }
  const allowed = declaredOptions(question) as Set<string>;
  if (question.type === 'choice') {
    if (typeof raw.choice !== 'string' || raw.choice === '') {
      throw new JevError('response-invalid', `Answer "${name}" has no choice.`);
    }
    if (!allowed.has(raw.choice)) {
      throw new JevError(
        'response-invalid',
        `Answer "${name}" chose "${raw.choice}", which is not a declared option of that ` +
          `question. The declared options are: ${[...allowed].join(', ')}.`,
      );
    }
    if (!isPlainObject(raw.probabilities)) {
      throw new JevError('response-invalid', `Answer "${name}" has no probabilities.`);
    }
    return {
      type: 'choice',
      choice: raw.choice,
      probabilities: numberMap(name, 'probabilities', raw.probabilities, allowed),
      confidence: raw.confidence,
    };
  }
  if (!finiteNumber(raw.score) || raw.score < 0 || raw.score > 1) {
    throw new JevError('response-invalid', `Answer "${name}" has no score in 0 to 1.`);
  }
  return {
    type: 'score',
    score: raw.score,
    legend: isPlainObject(raw.legend) ? stringMap(name, 'legend', raw.legend, allowed) : undefined,
    probabilities: isPlainObject(raw.probabilities)
      ? numberMap(name, 'probabilities', raw.probabilities, allowed)
      : undefined,
    confidence: raw.confidence,
  };
}

/**
 * Turn a decoded response body into a result, or throw.
 *
 * The completeness check is the load-bearing part. A missing named answer raises; it never
 * returns undefined. That is what catches trap 5, where an ignored `each` key returns one answer
 * for a batch of many and every other call site sees a plausible success.
 */
export function parseJevResponse(
  body: unknown,
  questions: JevQuestions,
  latencyMs: number,
): JevResult {
  if (!isPlainObject(body)) {
    throw new JevError('response-invalid', 'Response body is not an object.');
  }
  // Trap 7: the resolved dated model, from the response.
  if (typeof body.model !== 'string' || body.model.trim() === '') {
    throw new JevError('response-invalid', 'Response carries no resolved model version.');
  }
  if (!isPlainObject(body.answers)) {
    throw new JevError('response-invalid', 'Response carries no answers object.');
  }
  const rawAnswers = body.answers;
  const missing = Object.keys(questions).filter((name) => !(name in rawAnswers));
  if (missing.length > 0) {
    throw new JevError(
      'incomplete',
      `Response is missing ${missing.length} of ${Object.keys(questions).length} named answers: ` +
        `${missing.join(', ')}. A missing answer is an error, never a silent undefined.`,
    );
  }
  // An answer NAME the caller never asked for is content too. An undeclared name used to be
  // ignored here and survived into whatever raw-answer record an app kept, because a value
  // whitelist constrains values and says nothing about keys.
  const undeclared = Object.keys(rawAnswers).filter((name) => !(name in questions));
  if (undeclared.length > 0) {
    throw new JevError(
      'response-invalid',
      `Response carries ${undeclared.length} answer name(s) that were never asked: ` +
        `${undeclared.join(', ')}. An undeclared answer name is refused, never ignored.`,
    );
  }
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    answers[name] = validateAnswer(name, question, rawAnswers[name]);
  }
  return {
    model: body.model,
    answers,
    usage: validateUsage(body.usage),
    provider: typeof body.provider === 'string' ? body.provider : null,
    latencyMs,
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

function readEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? {};
}

function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** A sleep the caller's AbortSignal can cut short, so an abort is not stuck behind a backoff. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Did the endpoint refuse the PROVIDER BLOCK, rather than the request?
 *
 * Recorded live on 2026-09-20: a `provider.only` naming no serving provider returns HTTP 404
 * with "No allowed providers are available for the selected model". A caller has to be able to
 * tell that apart from an ordinary failure, because the decision it forces is a policy one:
 * proceed without the routing constraint, or do not send the content at all.
 */
const PROVIDER_POLICY_HINTS = ['provider', 'data_collection', 'data collection', 'zdr'];

function rejectsProviderPolicy(status: number, text: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422 && status !== 501) return false;
  const lower = text.toLowerCase();
  return PROVIDER_POLICY_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Ask Jev.
 *
 * Returns null when JEV_SHADOW_ENABLED is off, WITHOUT touching the network. Throws JevError on
 * every failure, so a call site can catch once and fall back. Retries 429 and 5xx with
 * exponential backoff plus full jitter, honours retry-after within the call budget, and opens a
 * circuit breaker after repeated failure so a dead endpoint costs one rejected promise rather
 * than a timeout per item.
 *
 * Every call carries a provider routing policy, JEV_DEFAULT_PROVIDER_ROUTING unless the caller
 * names another. An endpoint that refuses the policy raises kind `provider-policy-rejected` and
 * is never retried, so the caller decides whether to send the content under a weaker policy.
 */
export async function askJev(
  state: unknown,
  questions: JevQuestions,
  options: JevOptions = {},
): Promise<JevResult | null> {
  const env = options.env ?? readEnv();
  if (!options.ignoreShadowFlag && !jevShadowEnabled(env)) {
    return null;
  }

  // Validate before anything else, so a bad question set fails the same way with or without a key.
  validateJevQuestions(questions);

  const apiKey = options.apiKey ?? env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new JevError('not-configured', 'OPENROUTER_API_KEY is not set.');
  }

  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new JevError('not-configured', 'No fetch implementation is available.');
  }
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 8_000;

  // The breaker is per credential, so one tenant's revoked key never gates another's call.
  const scopeKey = circuitKey(apiKey, options.circuitScope);
  if (circuitIsOpen(circuits.get(scopeKey), now)) {
    throw new JevError('circuit-open', 'Jev circuit is open after repeated failures.');
  }

  const appUrl = options.appUrl ?? env.JEV_APP_URL;
  const appName = options.appName ?? env.JEV_APP_NAME;
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
  // Attribution, so OpenRouter reports spend per app.
  if (appUrl) headers['http-referer'] = appUrl;
  if (appName) headers['x-title'] = appName;

  // Routing policy is per call and defaults to denying data collection. See JevProviderRouting.
  const provider = options.provider === undefined ? JEV_DEFAULT_PROVIDER_ROUTING : options.provider;
  const body = JSON.stringify({
    model: options.model ?? JEV_DEFAULT_MODEL,
    state,
    questions,
    ...(provider ? { provider } : {}),
  });

  const budgetMs = options.budgetMs ?? timeoutMs * maxAttempts;
  const callStartedAt = now();

  let lastError: JevError = new JevError('network', 'Jev was never called.', { retryable: true });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // The budget is wall clock for the WHOLE call, so an attempt gets whatever is left of it and
    // never the full timeout. Without this an 8-second timeout inside a 2-second budget overruns
    // the caller, and a late attempt starts with milliseconds left and no way to say so.
    const remainingBeforeAttempt = budgetMs - (now() - callStartedAt);
    if (remainingBeforeAttempt <= 0) {
      lastError = new JevError(
        'timeout',
        `The ${budgetMs} ms Jev call budget was spent before attempt ${attempt} could start, so ` +
          'the attempt was refused.',
        { status: lastError.status, retryable: true },
      );
      break;
    }
    const attemptTimeoutMs = Math.min(timeoutMs, remainingBeforeAttempt);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    const startedAt = now();
    let waitMs: number | null = null;
    try {
      const response = await fetchImpl(JEV_ENDPOINT, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (response.ok) {
        const decoded: unknown = await response.json();
        const result = parseJevResponse(decoded, questions, now() - startedAt);
        circuits.delete(scopeKey);
        return result;
      }
      const text = await response.text().catch(() => '');
      if (provider && rejectsProviderPolicy(response.status, text)) {
        // Named, never retried: retrying an unsatisfiable routing policy just spends the budget.
        throw new JevError(
          'provider-policy-rejected',
          `Jev refused the provider routing policy with HTTP ${response.status}: ` +
            `${text.slice(0, 400)} The caller decides whether to proceed with a weaker policy.`,
          { status: response.status, retryable: false },
        );
      }
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new JevError(
        'http',
        `Jev returned HTTP ${response.status}: ${text.slice(0, 400)}`,
        { status: response.status, retryable },
      );
      if (retryable) waitMs = retryAfterMs(response.headers);
    } catch (error) {
      if (error instanceof JevError) {
        // A policy refusal is the caller's decision to make, so it leaves here unwrapped.
        if (error.kind === 'provider-policy-rejected') throw error;
        // A validation failure is deterministic. Retrying it buys nothing.
        lastError = error;
      } else if (options.signal?.aborted) {
        lastError = new JevError('network', 'The caller aborted the Jev call.');
      } else if ((error as { name?: string })?.name === 'AbortError') {
        lastError = new JevError('timeout', `Jev did not answer within ${attemptTimeoutMs} ms.`, {
          retryable: true,
        });
      } else {
        lastError = new JevError('network', `Jev call failed: ${String(error)}`, {
          retryable: true,
        });
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    if (!lastError.retryable || attempt === maxAttempts) break;
    // Exponential backoff with FULL jitter. A fleet of crons retrying in lockstep is how a 429
    // becomes an outage.
    const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    const asked = waitMs ?? Math.round(random() * ceiling);
    // Retry-After is a server's wish, not an instruction. A five-minute wait inside a 90-second
    // cron is a platform timeout, which records nothing; a refused wait records a Jev error.
    const wait = Math.min(asked, maxDelayMs);
    const remainingMs = budgetMs - (now() - callStartedAt);
    if (wait >= remainingMs) {
      lastError = new JevError(
        lastError.kind,
        `${lastError.message} The retry wait of ${wait} ms does not fit the remaining ` +
          `${Math.max(0, Math.round(remainingMs))} ms of the ${budgetMs} ms budget, so the ` +
          'retry was refused.',
        { status: lastError.status, retryable: lastError.retryable },
      );
      break;
    }
    await sleep(wait, options.signal);
    if (options.signal?.aborted) {
      lastError = new JevError('network', 'The caller aborted the Jev call.');
      break;
    }
  }

  // Only a shared failure counts. A 400 or 401 is this caller's own, and five of them across
  // five tenants must not open a breaker that gates a sixth.
  if (isSharedCircuitFailure(lastError)) {
    const entry = circuitFor(scopeKey);
    entry.failures += 1;
    if (entry.failures >= CIRCUIT_FAILURE_THRESHOLD) entry.openedAt = now();
  }
  throw lastError;
}
