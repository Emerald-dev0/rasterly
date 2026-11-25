import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderError } from '../src/engine/errors.js';

const { launchMock } = vi.hoisted(() => ({
  launchMock: vi.fn(),
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: launchMock,
  },
}));

import { BrowserManager } from '../src/engine/browser.js';

function makeFakeContext() {
  return {
    setDefaultTimeout: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  launchMock.mockReset();
});

describe('BrowserManager concurrency', () => {
  it('enforces configured concurrency deterministically', async () => {
    const contexts = [makeFakeContext(), makeFakeContext(), makeFakeContext()];
    const browser = {
      newContext: vi
        .fn()
        .mockResolvedValueOnce(contexts[0])
        .mockResolvedValueOnce(contexts[1])
        .mockResolvedValueOnce(contexts[2]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserManager({ concurrency: 2 });

    const ctx1 = await manager.createContext();
    const ctx2 = await manager.createContext();
    expect(ctx1).toBe(contexts[0]);
    expect(ctx2).toBe(contexts[1]);
    expect(manager.activeContextCount).toBe(2);

    await expect(manager.createContext()).rejects.toMatchObject({
      code: 'BROWSER_ERROR',
      message: 'Render concurrency limit reached, try again shortly',
    } satisfies Partial<RenderError>);
    expect(manager.activeContextCount).toBe(2);
    expect(browser.newContext).toHaveBeenCalledTimes(2);

    manager.releaseContext();
    expect(manager.activeContextCount).toBe(1);

    const ctx3 = await manager.createContext();
    expect(ctx3).toBe(contexts[2]);
    expect(manager.activeContextCount).toBe(2);
    expect(browser.newContext).toHaveBeenCalledTimes(3);
  });

  it('does not corrupt active count when context creation fails', async () => {
    const context = makeFakeContext();
    const browser = {
      newContext: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(context),
      close: vi.fn().mockResolvedValue(undefined),
    };
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserManager({ concurrency: 1 });

    await expect(manager.createContext()).rejects.toThrow('boom');
    expect(manager.activeContextCount).toBe(0);

    await expect(manager.createContext()).resolves.toBe(context);
    expect(manager.activeContextCount).toBe(1);
  });

  it('releases slot after a render-style finally cleanup', async () => {
    const context = makeFakeContext();
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    };
    launchMock.mockResolvedValue(browser);

    const manager = new BrowserManager({ concurrency: 1 });
    const acquired = await manager.createContext();
    try {
      expect(acquired).toBe(context);
      throw new Error('render failed');
    } catch {
      // simulate render failure
    } finally {
      manager.releaseContext();
      await acquired.close().catch(() => undefined);
    }

    expect(manager.activeContextCount).toBe(0);
    await expect(manager.createContext()).resolves.toBe(context);
  });
});