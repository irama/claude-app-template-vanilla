import { describe, expect, it, vi } from 'vitest';
import { HttpError, fetchJson, fetchWithTimeout, withRetry } from './http';

describe('withRetry', () => {
  it('retries thrown errors then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok');
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries HttpError 500 but not 400', async () => {
    const server = vi.fn().mockRejectedValue(new HttpError(500, 'u', ''));
    await expect(withRetry(server, { retries: 1, baseDelayMs: 1 })).rejects.toThrow('HTTP 500');
    expect(server).toHaveBeenCalledTimes(2);

    const client = vi.fn().mockRejectedValue(new HttpError(400, 'u', 'bad'));
    await expect(withRetry(client, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('HTTP 400');
    expect(client).toHaveBeenCalledTimes(1);
  });

  it('gives up after retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('fetchWithTimeout / fetchJson', () => {
  it('aborts when the timeout elapses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      })
    );
    await expect(fetchWithTimeout('https://x.test', { timeoutMs: 10 })).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('fetchJson throws HttpError on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 }))
    );
    await expect(fetchJson('https://x.test')).rejects.toBeInstanceOf(HttpError);
    vi.unstubAllGlobals();
  });

  it('fetchJson parses 2xx JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ a: 1 }))
    );
    await expect(fetchJson('https://x.test')).resolves.toEqual({ a: 1 });
    vi.unstubAllGlobals();
  });
});
