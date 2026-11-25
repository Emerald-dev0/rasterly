import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { BrowserManager } from '../src/engine/browser.js';
import { createApp, loadConfig } from '../src/server/app.js';

const { renderToImageMock } = vi.hoisted(() => ({
  renderToImageMock: vi.fn(),
}));

vi.mock('../src/engine/render.js', async () => {
  const actual = await vi.importActual<typeof import('../src/engine/render.js')>(
    '../src/engine/render.js',
  );
  return {
    ...actual,
    renderToImage: renderToImageMock,
  };
});

afterEach(() => {
  renderToImageMock.mockReset();
});

describe('loadConfig', () => {
  it('uses defaults when env vars are absent', () => {
    const config = loadConfig({});
    expect(config.port).toBe(8787);
    expect(config.host).toBe('127.0.0.1');
    expect(config.maxRequestBytes).toBe('2mb');
    expect(config.enableUrlCapture).toBe(true);
    expect(config.renderTimeoutMs).toBe(30_000);
    expect(config.renderConcurrency).toBe(4);
  });

  it('reads valid render env vars', () => {
    const config = loadConfig({
      RENDER_TIMEOUT_MS: '60000',
      RENDER_CONCURRENCY: '2',
    });
    expect(config.renderTimeoutMs).toBe(60_000);
    expect(config.renderConcurrency).toBe(2);
  });

  it('accepts boundary values and trims whitespace', () => {
    const config = loadConfig({
      RENDER_TIMEOUT_MS: ' 120000 ',
      RENDER_CONCURRENCY: '1',
    });
    expect(config.renderTimeoutMs).toBe(120_000);
    expect(config.renderConcurrency).toBe(1);
  });

  it('treats empty render env vars as defaults', () => {
    const config = loadConfig({
      RENDER_TIMEOUT_MS: '  ',
      RENDER_CONCURRENCY: '',
    });
    expect(config.renderTimeoutMs).toBe(30_000);
    expect(config.renderConcurrency).toBe(4);
  });

  it.each([
    ['RENDER_TIMEOUT_MS', '999'],
    ['RENDER_TIMEOUT_MS', '120001'],
    ['RENDER_TIMEOUT_MS', '1.5'],
    ['RENDER_TIMEOUT_MS', 'abc'],
    ['RENDER_TIMEOUT_MS', '-1'],
    ['RENDER_CONCURRENCY', '0'],
    ['RENDER_CONCURRENCY', '-1'],
    ['RENDER_CONCURRENCY', '1.5'],
    ['RENDER_CONCURRENCY', 'abc'],
  ])('rejects invalid %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(new RegExp(`Invalid ${name}`));
  });
});

describe('createApp render wiring', () => {
  it('passes configured timeout and browser manager to renderToImage', async () => {
    renderToImageMock.mockResolvedValue({
      buffer: Buffer.from('png'),
      mimeType: 'image/png',
      extension: 'png',
      metadata: {
        width: 1,
        height: 1,
        format: 'png',
        scale: 1,
        bytes: 3,
        durationMs: 1,
        fullPage: false,
        transparent: false,
      },
    });

    const browserManager = new BrowserManager({ concurrency: 2 });
    const config = loadConfig({
      RENDER_TIMEOUT_MS: '45000',
      RENDER_CONCURRENCY: '2',
      URL_ALLOWED_HOSTS: 'example.com',
      URL_BLOCKED_HOSTS: 'blocked.example.com',
    });
    const app = createApp(config, { browserManager });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: '<h1>Hi</h1>',
          inputType: 'html',
          format: 'png',
          width: 100,
          height: 100,
          scale: 1,
          fullPage: false,
          transparent: false,
          backgroundColor: '#ffffff',
          quality: 90,
        }),
      });

      expect(response.status).toBe(200);
      expect(renderToImageMock).toHaveBeenCalledTimes(1);
      expect(renderToImageMock).toHaveBeenCalledWith(
        expect.objectContaining({ code: '<h1>Hi</h1>', inputType: 'html' }),
        {
          allowedHosts: ['example.com'],
          blockedHosts: ['blocked.example.com'],
          browser: browserManager,
          defaultTimeoutMs: 45_000,
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});