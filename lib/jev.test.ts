/**
 * Jev conformance suite — the GOLDEN TypeScript copy.
 *
 * Covers the seven API traps, the completeness check, the kill switch, retry with jitter and the
 * circuit breaker. Every case runs against a RECORDED response in `lib/jev-fixtures.json`. No
 * live call runs by default; set JEV_LIVE=1 and OPENROUTER_API_KEY to opt in to the single test
 * that talks to the endpoint.
 *
 * Run it:   pnpm vitest run lib/jev.test.ts
 *
 * This file is vendored alongside `lib/jev.ts`. Every repo that vendors the client runs this
 * suite unchanged, so a copy that has quietly drifted fails here as well as in the checksum
 * report from `scripts/jev-sync.py`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

import fixtures from './jev-fixtures.json';
import {
  askJev,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_PROVIDER_ROUTING,
  JEV_ENDPOINT,
  JevError,
  jevConfidence,
  jevCircuitState,
  jevShadowEnabled,
  noulVerdict,
  parseJevResponse,
  resetJevCircuit,
  validateJevQuestions,
  type JevQuestions,
} from './jev';

const ON = { OPENROUTER_API_KEY: 'test-key', JEV_SHADOW_ENABLED: '1' };
const QUESTIONS = fixtures.questions as unknown as JevQuestions;

interface Recorded {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: Error;
}

/** A fetch stand-in that replays recorded responses in order and counts its calls. */
function replay(...recorded: Recorded[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = recorded[Math.min(calls.length - 1, recorded.length - 1)];
    if (next.throws) throw next.throws;
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(next.headers ?? {}),
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? ''),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Deterministic timing knobs, so the suite never actually waits. */
const noWait = { sleep: async () => {}, random: () => 0.5 };

async function expectJevError(promise: Promise<unknown>, kind: string): Promise<JevError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `expected a JevError of kind ${kind}`).toBeInstanceOf(JevError);
  expect((error as JevError).kind).toBe(kind);
  return error as JevError;
}

beforeEach(() => resetJevCircuit());

describe('trap 1 — the field is instructions, never question', () => {
  it('refuses a question field locally instead of earning an HTTP 400', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    const bad = { is_spam: { type: 'noul', question: 'Is it spam?' } } as unknown as JevQuestions;
    const error = await expectJevError(
      askJev(fixtures.state, bad, { env: ON, fetchImpl: impl, ...noWait }),
      'request-invalid',
    );
    expect(error.message).toContain('instructions');
    expect(calls).toHaveLength(0);
  });
});

describe('trap 2 — choice requires criteria as an object', () => {
  it('rejects a choice with no criteria', () => {
    const bad = { kind: { type: 'choice', instructions: 'Classify it.' } } as unknown as JevQuestions;
    expect(() => validateJevQuestions(bad)).toThrow(/criteria/);
  });

  it('rejects a choice whose criteria is an array', () => {
    const bad = {
      kind: { type: 'choice', instructions: 'Classify it.', criteria: ['spam', 'work'] },
    } as unknown as JevQuestions;
    expect(() => validateJevQuestions(bad)).toThrow(/object/);
  });
});

describe('trap 3 — score requires criteria as an array', () => {
  it('rejects a score with no criteria', () => {
    const bad = { urgency: { type: 'score', instructions: 'How urgent.' } } as unknown as JevQuestions;
    expect(() => validateJevQuestions(bad)).toThrow(/array/);
  });

  it('rejects a score whose criteria is an object', () => {
    const bad = {
      urgency: { type: 'score', instructions: 'How urgent.', criteria: { low: 'a', high: 'b' } },
    } as unknown as JevQuestions;
    expect(() => validateJevQuestions(bad)).toThrow(/array/);
  });
});

describe('trap 4 — noul takes no criteria and returns no confidence', () => {
  it('rejects a noul that carries criteria', () => {
    const bad = {
      is_spam: { type: 'noul', instructions: 'It is spam.', criteria: ['no', 'yes'] },
    } as unknown as JevQuestions;
    expect(() => validateJevQuestions(bad)).toThrow(/criteria/);
  });

  it('reports a null confidence for a noul and thresholds the probability instead', () => {
    const only = { is_spam: QUESTIONS.is_spam };
    const result = parseJevResponse(fixtures.responses.noulOnly, only, 1);
    expect(jevConfidence(result.answers.is_spam)).toBeNull();
    expect(noulVerdict(0.52)).toBe('uncertain');
    expect(noulVerdict(0.97)).toBe('true');
    expect(noulVerdict(0.03)).toBe('false');
  });
});

describe('trap 5 — there is no per-row iteration', () => {
  it('rejects an "each" key rather than letting it be silently ignored', () => {
    const bad = {
      each: { type: 'noul', instructions: 'For every row.' },
      is_spam: QUESTIONS.is_spam,
    } as unknown as JevQuestions;
    expect(() => validateJevQuestions(bad)).toThrow(/per-row iteration/);
  });

  it('raises on a missing named answer rather than returning undefined', async () => {
    const { impl } = replay({ body: fixtures.responses.eachIgnored });
    const error = await expectJevError(
      askJev(fixtures.state, QUESTIONS, { env: ON, fetchImpl: impl, ...noWait }),
      'incomplete',
    );
    expect(error.message).toContain('kind');
    expect(error.message).toContain('urgency');
  });
});

describe('trap 6 — Jev is absent from the public model list', () => {
  it('never probes /api/v1/models and posts only to the alpha decisions endpoint', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/jev.ts'), 'utf8');
    const probes = source.split('\n').filter((line) => line.includes('/api/v1/models'));
    // The only mention allowed is the comment saying not to probe there.
    expect(probes.every((line) => line.trimStart().startsWith('*'))).toBe(true);
    expect(JEV_ENDPOINT).toBe('https://openrouter.ai/api/alpha/decisions');
  });
});

describe('trap 7 — record the resolved dated model, never the alias', () => {
  it('sends the alias and returns the dated version from the response', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    const result = await askJev(fixtures.state, QUESTIONS, {
      env: ON,
      fetchImpl: impl,
      appUrl: 'https://example.tld',
      appName: 'Example',
      ...noWait,
    });
    expect(JSON.parse(String(calls[0].init.body)).model).toBe(JEV_DEFAULT_MODEL);
    expect(result?.model).toBe(fixtures.resolvedModel);
    expect(result?.model).not.toBe(fixtures.aliasModel);
  });
});

describe('the kill switch', () => {
  it('reads JEV_SHADOW_ENABLED independently of OPENROUTER_API_KEY', () => {
    expect(jevShadowEnabled({ JEV_SHADOW_ENABLED: '1' })).toBe(true);
    expect(jevShadowEnabled({ JEV_SHADOW_ENABLED: 'true' })).toBe(true);
    expect(jevShadowEnabled({ JEV_SHADOW_ENABLED: '0', OPENROUTER_API_KEY: 'k' })).toBe(false);
    expect(jevShadowEnabled({ OPENROUTER_API_KEY: 'k' })).toBe(false);
  });

  it('short-circuits to null without touching the network when it is off', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    const result = await askJev(fixtures.state, QUESTIONS, {
      env: { OPENROUTER_API_KEY: 'test-key', JEV_SHADOW_ENABLED: '0' },
      fetchImpl: impl,
      ...noWait,
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('transport', () => {
  it('sends the attribution headers on every call', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    await askJev(fixtures.state, QUESTIONS, {
      env: ON,
      fetchImpl: impl,
      appUrl: 'https://example.tld',
      appName: 'Example',
      ...noWait,
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['http-referer']).toBe('https://example.tld');
    expect(headers['x-title']).toBe('Example');
    expect(headers.authorization).toBe('Bearer test-key');
  });

  it('retries a 429 and honours retry-after', async () => {
    const waits: number[] = [];
    const { impl, calls } = replay(
      { status: 429, headers: { 'retry-after': '2' }, body: { error: 'slow down' } },
      { body: fixtures.responses.complete },
    );
    const result = await askJev(fixtures.state, QUESTIONS, {
      env: ON,
      fetchImpl: impl,
      random: () => 0.5,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
    expect(result?.model).toBe(fixtures.resolvedModel);
  });

  it('backs off with jitter when there is no retry-after', async () => {
    const waits: number[] = [];
    const { impl } = replay({ status: 503, body: { error: 'unavailable' } });
    await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        fetchImpl: impl,
        maxAttempts: 3,
        baseDelayMs: 100,
        random: () => 0.5,
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
      'http',
    );
    // Full jitter: half of the 100 ms and 200 ms ceilings.
    expect(waits).toEqual([50, 100]);
  });

  it('does not retry a 400', async () => {
    const { impl, calls } = replay({ status: 400, body: { error: 'bad request' } });
    await expectJevError(
      askJev(fixtures.state, QUESTIONS, { env: ON, fetchImpl: impl, ...noWait }),
      'http',
    );
    expect(calls).toHaveLength(1);
  });

  it('times out and reports it as a timeout', async () => {
    const impl = ((url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;
    await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        fetchImpl: impl,
        timeoutMs: 5,
        maxAttempts: 1,
        ...noWait,
      }),
      'timeout',
    );
  });

  it('caps a generous retry-after at maxDelayMs', async () => {
    const waits: number[] = [];
    const { impl } = replay(
      { status: 429, headers: { 'retry-after': '300' }, body: { error: 'slow down' } },
      { body: fixtures.responses.complete },
    );
    await askJev(fixtures.state, QUESTIONS, {
      env: ON,
      fetchImpl: impl,
      maxAttempts: 2,
      maxDelayMs: 5_000,
      budgetMs: 60_000,
      random: () => 0.5,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([5_000]);
  });

  it('refuses a wait that does not fit the remaining budget and records a Jev error', async () => {
    const waits: number[] = [];
    const { impl, calls } = replay({
      status: 429,
      headers: { 'retry-after': '300' },
      body: { error: 'slow down' },
    });
    const error = await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        fetchImpl: impl,
        maxAttempts: 3,
        maxDelayMs: 300_000,
        // A 90-second cron cannot afford the five-minute wait the header asks for.
        budgetMs: 90_000,
        random: () => 0.5,
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
      'http',
    );
    expect(waits).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(error.message).toContain('retry was refused');
  });

  it('clamps an attempt timeout to the remaining budget', async () => {
    // A 2-second budget must not hand an 8-second timeout to the attempt inside it.
    const impl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;
    const startedAt = Date.now();
    const error = await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        fetchImpl: impl,
        timeoutMs: 8_000,
        budgetMs: 40,
        maxAttempts: 1,
        ...noWait,
      }),
      'timeout',
    );
    const clamped = Number(/within (\d+) ms/.exec(error.message)?.[1]);
    expect(clamped).toBeLessThanOrEqual(40);
    expect(clamped).toBeGreaterThan(0);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('refuses an attempt that does not fit the budget, without calling', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    const error = await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        fetchImpl: impl,
        budgetMs: 0,
        ...noWait,
      }),
      'timeout',
    );
    expect(calls).toHaveLength(0);
    expect(error.message).toContain('attempt was refused');
  });

  it('cuts the backoff short when the caller aborts', async () => {
    const controller = new AbortController();
    const { impl, calls } = replay({ status: 503, body: { error: 'unavailable' } });
    const error = await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        fetchImpl: impl,
        maxAttempts: 3,
        baseDelayMs: 10,
        random: () => 0.5,
        signal: controller.signal,
        // The real sleep, aborted mid-wait. Nothing here waits longer than the abort.
        sleep: async (ms, signal) => {
          controller.abort();
          await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            const timer = setTimeout(resolve, ms);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            });
          });
        },
      }),
      'network',
    );
    expect(error.message).toContain('aborted');
    expect(calls).toHaveLength(1);
  });

  it('opens the circuit after repeated failure and then refuses without a call', async () => {
    const { impl, calls } = replay({ throws: new TypeError('network down') });
    for (let i = 0; i < 5; i += 1) {
      await expectJevError(
        askJev(fixtures.state, QUESTIONS, {
          env: ON,
          fetchImpl: impl,
          maxAttempts: 1,
          ...noWait,
        }),
        'network',
      );
    }
    expect(jevCircuitState()).toBe('open');
    const before = calls.length;
    await expectJevError(
      askJev(fixtures.state, QUESTIONS, { env: ON, fetchImpl: impl, ...noWait }),
      'circuit-open',
    );
    expect(calls).toHaveLength(before);
  });

  it('keeps one credential\'s failures off another credential\'s breaker', async () => {
    const { impl, calls } = replay({ throws: new TypeError('network down') });
    for (let i = 0; i < 5; i += 1) {
      await expectJevError(
        askJev(fixtures.state, QUESTIONS, {
          env: ON,
          apiKey: 'key-alice',
          fetchImpl: impl,
          maxAttempts: 1,
          ...noWait,
        }),
        'network',
      );
    }
    // Alice is shut out, and Bob is not: the breaker is keyed by credential.
    await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        apiKey: 'key-alice',
        fetchImpl: impl,
        ...noWait,
      }),
      'circuit-open',
    );
    const before = calls.length;
    await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        apiKey: 'key-bob',
        fetchImpl: impl,
        maxAttempts: 1,
        ...noWait,
      }),
      'network',
    );
    expect(calls.length).toBe(before + 1);
  });

  it('never opens on a 401, because a revoked key is one caller\'s fault', async () => {
    const { impl, calls } = replay({ status: 401, body: { error: 'revoked key' } });
    for (let i = 0; i < 6; i += 1) {
      await expectJevError(
        askJev(fixtures.state, QUESTIONS, {
          env: ON,
          fetchImpl: impl,
          maxAttempts: 1,
          ...noWait,
        }),
        'http',
      );
    }
    expect(jevCircuitState()).toBe('closed');
    // Every one of the six went out. A non-retryable status never becomes everyone's outage.
    expect(calls).toHaveLength(6);
  });

  it('isolates two callers that share one key when they name a scope', async () => {
    const { impl } = replay({ throws: new TypeError('network down') });
    for (let i = 0; i < 5; i += 1) {
      await expectJevError(
        askJev(fixtures.state, QUESTIONS, {
          env: ON,
          circuitScope: 'tenant-a',
          fetchImpl: impl,
          maxAttempts: 1,
          ...noWait,
        }),
        'network',
      );
    }
    expect(jevCircuitState(Date.now, 'tenant-a')).toBe('open');
    expect(jevCircuitState(Date.now, 'tenant-b')).toBe('closed');
  });
});

describe('provider routing', () => {
  it('sends the deny-retention policy on every call by default', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    await askJev(fixtures.state, QUESTIONS, { env: ON, fetchImpl: impl, ...noWait });
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.provider).toEqual(JEV_DEFAULT_PROVIDER_ROUTING);
    expect(sent.provider.data_collection).toBe('deny');
    expect(fixtures.providerRouting.data_collection).toBe('deny');
  });

  it('carries zdr through when a caller opts in', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    await askJev(fixtures.state, QUESTIONS, {
      env: ON,
      fetchImpl: impl,
      provider: { data_collection: 'deny', allow_fallbacks: true, zdr: true },
      ...noWait,
    });
    expect(JSON.parse(String(calls[0].init.body)).provider.zdr).toBe(true);
  });

  it('sends no provider block when the caller passes null', async () => {
    const { impl, calls } = replay({ body: fixtures.responses.complete });
    await askJev(fixtures.state, QUESTIONS, {
      env: ON,
      fetchImpl: impl,
      provider: null,
      ...noWait,
    });
    expect('provider' in JSON.parse(String(calls[0].init.body))).toBe(false);
  });

  it('names a refused policy as its own error and does not retry it', async () => {
    const { impl, calls } = replay({
      status: 404,
      body: fixtures.responses.providerRejected,
    });
    const error = await expectJevError(
      askJev(fixtures.state, QUESTIONS, {
        env: ON,
        fetchImpl: impl,
        provider: { only: ['no-such-provider-xyz'] },
        maxAttempts: 3,
        ...noWait,
      }),
      'provider-policy-rejected',
    );
    expect(error.status).toBe(404);
    expect(error.retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('still reports an ordinary 404 as an http error when no policy was sent', async () => {
    const { impl } = replay({ status: 404, body: { error: 'no such route' } });
    await expectJevError(
      askJev(fixtures.state, QUESTIONS, { env: ON, fetchImpl: impl, provider: null, ...noWait }),
      'http',
    );
  });
});

describe('response validation', () => {
  it('rejects a response with no resolved model', () => {
    expect(() => parseJevResponse({ answers: {} }, QUESTIONS, 1)).toThrow(/resolved model/);
  });

  it('rejects an answer whose type is not the one asked', () => {
    const body = {
      model: fixtures.resolvedModel,
      answers: { is_spam: { type: 'choice', choice: 'x', probabilities: {}, confidence: 1 } },
    };
    expect(() => parseJevResponse(body, { is_spam: QUESTIONS.is_spam }, 1)).toThrow(/is_spam/);
  });

  it('rejects a non-finite probability, matching the Python client', () => {
    const body = {
      model: fixtures.resolvedModel,
      answers: { is_spam: { type: 'noul', noul: Number.POSITIVE_INFINITY } },
    };
    expect(() => parseJevResponse(body, { is_spam: QUESTIONS.is_spam }, 1)).toThrow(/is_spam/);
  });

  it('rejects a choice answer with no confidence', () => {
    const body = {
      model: fixtures.resolvedModel,
      answers: { kind: { type: 'choice', choice: 'work', probabilities: { work: 1 } } },
    };
    expect(() => parseJevResponse(body, { kind: QUESTIONS.kind }, 1)).toThrow(/confidence/);
  });

  // A declared option name with a sentence of the caller's own input as its value. A filter that
  // drops unknown KEYS keeps this, because the key is declared. The client refuses the answer.
  it('rejects a probability VALUE that is not a number, not only a bad key', () => {
    const body = {
      model: fixtures.resolvedModel,
      answers: {
        kind: {
          type: 'choice',
          choice: 'work',
          probabilities: { work: 'the manuscript excerpt that must never be stored', spam: 0.1 },
          confidence: 0.9,
        },
      },
    };
    expect(() => parseJevResponse(body, { kind: QUESTIONS.kind }, 1)).toThrow(
      /"probabilities" value for "work"/,
    );
  });

  it('rejects a non-finite probability value inside the map', () => {
    const body = {
      model: fixtures.resolvedModel,
      answers: {
        kind: {
          type: 'choice',
          choice: 'work',
          probabilities: { work: Number.NaN },
          confidence: 0.9,
        },
      },
    };
    expect(() => parseJevResponse(body, { kind: QUESTIONS.kind }, 1)).toThrow(/probabilities/);
  });

  it('rejects a score answer whose probability value is not a number', () => {
    const body = {
      model: fixtures.resolvedModel,
      answers: {
        urgency: {
          type: 'score',
          score: 0.7,
          probabilities: { '1': { nested: 'content' } },
          confidence: 0.8,
        },
      },
    };
    expect(() => parseJevResponse(body, { urgency: QUESTIONS.urgency }, 1)).toThrow(
      /probabilities/,
    );
  });

  it('rejects a legend value that is not a non-empty string', () => {
    const body = {
      model: fixtures.resolvedModel,
      answers: {
        urgency: { type: 'score', score: 0.7, legend: { '0': 12 }, confidence: 0.8 },
      },
    };
    expect(() => parseJevResponse(body, { urgency: QUESTIONS.urgency }, 1)).toThrow(/legend/);
  });

  // --- The declared taxonomy is enforced at the client (review finding C1) ---

  it('rejects an answer name that was never asked', () => {
    const body = structuredClone(fixtures.responses.complete);
    (body.answers as Record<string, unknown>)['PRIVATE INPUT ECHO'] = { type: 'noul', noul: 0.5 };
    expect(() => parseJevResponse(body, QUESTIONS, 1)).toThrow(/PRIVATE INPUT ECHO/);
  });

  it('rejects a choice outside the declared criteria', () => {
    const body = structuredClone(fixtures.responses.complete);
    body.answers.kind.choice = 'PRIVATE INPUT ECHO';
    expect(() => parseJevResponse(body, QUESTIONS, 1)).toThrow(/not a declared option/);
  });

  it('rejects a probability key outside the declared criteria', () => {
    const body = structuredClone(fixtures.responses.complete);
    (body.answers.kind.probabilities as Record<string, number>)['PRIVATE INPUT ECHO'] = 0.1;
    expect(() => parseJevResponse(body, QUESTIONS, 1)).toThrow(/not a declared option/);
  });

  it('rejects a probability outside 0 to 1', () => {
    const body = structuredClone(fixtures.responses.complete);
    body.answers.kind.probabilities.work = 2.5;
    expect(() => parseJevResponse(body, QUESTIONS, 1)).toThrow(/0 to 1/);
  });

  it('rejects a legend key that is not a declared anchor', () => {
    const body = structuredClone(fixtures.responses.complete);
    (body.answers.urgency.legend as Record<string, string>)['9'] =
      'an anchor nobody declared';
    expect(() => parseJevResponse(body, QUESTIONS, 1)).toThrow(/not a declared anchor/);
  });

  it('rejects a score outside 0 to 1', () => {
    const body = structuredClone(fixtures.responses.complete);
    body.answers.urgency.score = 4;
    expect(() => parseJevResponse(body, QUESTIONS, 1)).toThrow(/score in 0 to 1/);
  });

  it('keeps a well-formed answer intact, values and all', () => {
    const result = parseJevResponse(fixtures.responses.complete, QUESTIONS, 1);
    const kind = result.answers.kind as { probabilities: Record<string, number> };
    expect(kind.probabilities.work).toBe(0.95);
    expect(result.usage?.input_tokens).toBe(573);
  });

  it('reports no usage rather than a cast when the usage block is malformed', () => {
    const body = {
      ...(fixtures.responses.complete as Record<string, unknown>),
      usage: { input_tokens: 10, output_tokens: 2, cost: 'free' },
    };
    expect(parseJevResponse(body, QUESTIONS, 1).usage).toBeNull();
  });
});

// Opt-in only. It costs money and needs the network, so it never runs in the default suite.
const live = process.env.JEV_LIVE === '1' && Boolean(process.env.OPENROUTER_API_KEY);
describe.runIf(live)('live endpoint', () => {
  it('answers a real batch and returns a dated model', async () => {
    const result = await askJev(fixtures.state, QUESTIONS, {
      env: { ...process.env, JEV_SHADOW_ENABLED: '1' },
      appUrl: 'https://example.tld',
      appName: 'Jev conformance',
      timeoutMs: 30_000,
    });
    expect(result?.model).toMatch(/^typesafe\/jev-.+-\d{8}$/);
    expect(Object.keys(result?.answers ?? {})).toHaveLength(Object.keys(QUESTIONS).length);
  }, 40_000);
});
