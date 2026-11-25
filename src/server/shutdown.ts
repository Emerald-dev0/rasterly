import type { Server } from 'node:http';

export interface ShutdownTarget {
  close: () => Promise<void>;
}

export async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeIdleConnections?.();
  });
}

export function createShutdownHandler(server: Server, target: ShutdownTarget) {
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.log(`\n${signal} received, shutting down...`);
      let exitCode = 0;
      try {
        await closeHttpServer(server);
      } catch (error) {
        exitCode = 1;
        console.error('Error closing HTTP server:', error);
      }
      try {
        await target.close();
      } catch (error) {
        exitCode = 1;
        console.error('Error closing browser manager:', error);
      }
      if (exitCode !== 0) process.exitCode = exitCode;
    })();
    return shutdownPromise;
  };

  return shutdown;
}