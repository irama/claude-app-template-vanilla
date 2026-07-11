/**
 * Wrappers for all third-party HTTP calls (production-playbook.md, failure classes 4–5).
 * Never call bare fetch() against an external API — timeouts and retries are explicit here.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 500)}`);
    this.name = 'HttpError';
  }
}

/** fetch with a hard timeout (default 30s — generous on purpose; tune per call, not down globally). */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init;
  const signals = [AbortSignal.timeout(timeoutMs), ...(rest.signal ? [rest.signal] : [])];
  return fetch(url, { ...rest, signal: AbortSignal.any(signals) });
}

/** fetchWithTimeout that throws HttpError on non-2xx, so failures are never silent. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const res = await fetchWithTimeout(url, init);
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  return (await res.json()) as T;
}

/**
 * Retry with exponential backoff. Retries on thrown errors (network, timeout) and,
 * for HttpError, only on 429/5xx — 4xx contract errors should surface immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 2, baseDelayMs = 500 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retriable =
        !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
      if (!retriable || attempt === retries) throw error;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}
