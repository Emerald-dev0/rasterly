import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserManager } from '../engine/browser.js';
import { renderToImage } from '../engine/render.js';
import { parseRenderConfig } from '../engine/validation.js';
import { RenderError } from '../engine/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseBytes(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}

function parseEnvInt(
  name: string,
  raw: string | undefined,
  opts: { defaultValue: number; min: number; max?: number },
): number {
  if (raw == null || raw.trim() === '') return opts.defaultValue;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Invalid ${name}: "${raw}" is not an integer`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a safe integer`);
  }
  if (value < opts.min) {
    throw new Error(`Invalid ${name}: "${raw}" must be >= ${opts.min}`);
  }
  if (opts.max != null && value > opts.max) {
    throw new Error(`Invalid ${name}: "${raw}" must be <= ${opts.max}`);
  }
  return value;
}

export interface ServerConfig {
  port: number;
  host: string;
  maxRequestBytes: string;
  enableUrlCapture: boolean;
  urlAllowedHosts: string[];
  urlBlockedHosts: string[];
  renderTimeoutMs: number;
  renderConcurrency: number;
}

export function loadConfig(env = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '127.0.0.1',
    maxRequestBytes: parseBytes(env.MAX_REQUEST_BYTES, '2mb'),
    enableUrlCapture: (env.ENABLE_URL_CAPTURE ?? 'true') !== 'false',
    urlAllowedHosts: (env.URL_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    urlBlockedHosts: (env.URL_BLOCKED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    renderTimeoutMs: parseEnvInt('RENDER_TIMEOUT_MS', env.RENDER_TIMEOUT_MS, {
      defaultValue: 30_000,
      min: 1000,
      max: 120_000,
    }),
    renderConcurrency: parseEnvInt('RENDER_CONCURRENCY', env.RENDER_CONCURRENCY, {
      defaultValue: 4,
      min: 1,
    }),
  };
}

export interface CreateAppDeps {
  browserManager?: BrowserManager;
}

export function createApp(config: ServerConfig, deps: CreateAppDeps = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: config.maxRequestBytes }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
  });

  app.post('/api/render', async (req, res, next) => {
    const parsed = parseRenderConfig(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Request validation failed',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    if (parsed.data.inputType === 'url' && !config.enableUrlCapture) {
      return res.status(403).json({
        error: 'UNSUPPORTED_OPERATION',
        message: 'URL capture is disabled on this server',
      });
    }

    try {
      const result = await renderToImage(parsed.data, {
        allowedHosts: config.urlAllowedHosts,
        blockedHosts: config.urlBlockedHosts,
        browser: deps.browserManager,
        defaultTimeoutMs: config.renderTimeoutMs,
      });
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('X-Rasterly-Metadata', JSON.stringify(result.metadata));
      res.setHeader('Cache-Control', 'no-store');
      res.send(result.buffer);
    } catch (error) {
      next(error);
    }
  });

  // Static frontend (production build).
  const frontendDir = resolve(__dirname, '../frontend');
  if (existsSync(frontendDir)) {
    app.use(express.static(frontendDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(resolve(frontendDir, 'index.html'));
    });
  }

  // Error handler.
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof RenderError) {
      const status =
        error.code === 'INVALID_INPUT'
          ? 400
          : error.code === 'SSRF_BLOCKED'
            ? 403
            : error.code === 'RENDER_TIMEOUT'
              ? 504
              : error.code === 'COMPILATION_ERROR'
                ? 422
                : 500;
      return res.status(status).json({ error: error.code, message: error.message, detail: error.detail });
    }
    const message = error instanceof Error ? error.message : 'Internal error';
    res.status(500).json({ error: 'INTERNAL_ERROR', message });
  });

  return app;
}