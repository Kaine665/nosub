/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage: Record<string, unknown> = {};

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(storage)) delete storage[key];
  (globalThis as { chrome?: typeof chrome }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => key in storage ? { [key]: storage[key] } : {}),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, values); }),
      },
    },
  } as unknown as typeof chrome;
});

describe('anonymous extension identity', () => {
  it('creates one UUID and keeps it stable across concurrent reads', async () => {
    const { getAnonymousId } = await import('../../src/analytics/anonymous-identity.js');
    const [first, second] = await Promise.all([getAnonymousId(), getAnonymousId()]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('reuses a valid ID already stored for this installation', async () => {
    storage['nosub-anonymous-id-v1'] = '11111111-1111-4111-8111-111111111111';
    const { getAnonymousId } = await import('../../src/analytics/anonymous-identity.js');
    expect(await getAnonymousId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
