import { BrowserManager } from '../engine/browser.js';
import { createApp, loadConfig } from './app.js';
import { createShutdownHandler } from './shutdown.js';

async function main() {
  const config = loadConfig();
  const browserManager = new BrowserManager({ concurrency: config.renderConcurrency });
  const app = createApp(config, { browserManager });
  const server = app.listen(config.port, config.host, () => {
    console.log(`Rasterly server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = createShutdownHandler(server, browserManager);

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error) => {
  console.error('Fatal:', error);
  process.exit(1);
});