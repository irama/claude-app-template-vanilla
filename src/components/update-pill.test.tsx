import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const BUNDLE = 'abc1234';

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', BUNDLE);
  return import('./update-pill');
}

function serveSha(sha: string | undefined) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => (sha ? { sha } : {}) }))
  );
}

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isStale', () => {
  it('matches a short bundle SHA against a full server SHA by prefix', async () => {
    const { isStale } = await load();
    expect(isStale('abc1234', 'abc1234ffffffffffffffffffffffffffffffff0')).toBe(false);
    expect(isStale('abc1234', 'def5678ffffffffffffffffffffffffffffffff0')).toBe(true);
  });

  it('never nags for a dev build or a missing server SHA', async () => {
    const { isStale } = await load();
    expect(isStale('dev', 'def5678')).toBe(false);
    expect(isStale('local-dev', 'def5678')).toBe(false);
    expect(isStale('abc1234', 'dev')).toBe(false);
    expect(isStale('abc1234', null)).toBe(false);
  });
});

describe('UpdatePill', () => {
  it('shows the pill when the server serves a newer commit', async () => {
    serveSha('def5678ffffffffffffffffffffffffffffffff0');
    const { UpdatePill } = await load();
    render(<UpdatePill />);
    expect(await screen.findByRole('button', { name: 'new version · reload' })).toBeTruthy();
  });

  it('stays hidden when the server serves this bundle', async () => {
    serveSha('abc1234ffffffffffffffffffffffffffffffff0');
    const { UpdatePill } = await load();
    render(<UpdatePill />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
  });
});
