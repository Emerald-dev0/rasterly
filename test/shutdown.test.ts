import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createShutdownHandler } from '../src/server/shutdown.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('createShutdownHandler', () => {
  it('keeps browser manager open during active request and closes it after server finishes', async () => {
    const requestGate = deferred<void>();
    const handlerEntered = deferred<void>();
    const server = createServer((_req, res) => {
      handlerEntered.resolve();
      void requestGate.promise.then(() => {
        res.statusCode = 200;
        res.end('ok');
      });
    });
    const port = await listen(server);

    const events: string[] = [];
    const browserManager = {
      close: vi.fn(async () => {
        events.push('browser-close');
      }),
    };
    const shutdown = createShutdownHandler(server, browserManager);

    const responsePromise = fetch(`http://127.0.0.1:${port}/`);
    await handlerEntered.promise;

    const shutdownPromise = shutdown('SIGTERM');
    events.push('shutdown-started');

    expect(server.listening).toBe(false);
    expect(browserManager.close).not.toHaveBeenCalled();

    requestGate.resolve();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    await shutdownPromise;

    expect(browserManager.close).toHaveBeenCalledTimes(1);
    expect(events.indexOf('browser-close')).toBeGreaterThan(events.indexOf('shutdown-started'));
    await closeServer(server);
  });

  it('does not run duplicate shutdown cleanup for repeated signals', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await listen(server);
    const browserManager = { close: vi.fn().mockResolvedValue(undefined) };
    const shutdown = createShutdownHandler(server, browserManager);

    await Promise.all([shutdown('SIGINT'), shutdown('SIGTERM')]);

    expect(browserManager.close).toHaveBeenCalledTimes(1);
  });

  it('attempts browser cleanup even if server shutdown fails', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await listen(server);
    const browserManager = { close: vi.fn().mockResolvedValue(undefined) };
    const shutdown = createShutdownHandler(server, browserManager);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const closeMock = vi.spyOn(server, 'close').mockImplementation(((cb?: (err?: Error) => void) => {
      cb?.(new Error('close failed'));
      return server;
    }) as Server['close']);

    await shutdown('SIGTERM');

    expect(browserManager.close).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    closeMock.mockRestore();
    await closeServer(server);
  });

  it('reports browser cleanup failure and sets nonzero exit code', async () => {
    const server = createServer((_req, res) => res.end('ok'));
    await listen(server);
    const browserManager = {
      close: vi.fn().mockRejectedValue(new Error('browser close failed')),
    };
    const shutdown = createShutdownHandler(server, browserManager);
    const closeSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await shutdown('SIGTERM');

    expect(browserManager.close).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(closeSpy).toHaveBeenCalled();
  });
});