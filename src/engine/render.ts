import { getBrowserManager } from './browser.js';
import { buildDocument } from './document-builder.js';
import { RenderError } from './errors.js';
import { detectInputType } from './input-parser.js';
import { processImage } from './image-processor.js';
import { compileJsx } from './jsx-compiler.js';
import { captureScreenshot } from './screenshot.js';
import { validateUrl } from './ssrf.js';
import {
  EXTENSIONS,
  MIME_TYPES,
  type NormalizedRenderConfig,
  type RenderConfig,
  type RenderResult,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export function normalizeConfig(
  config: RenderConfig,
  defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS,
): NormalizedRenderConfig {
  const inputType = detectInputType(config.code, config.inputType);
  return {
    code: config.code,
    inputType,
    format: config.format,
    width: config.width,
    height: config.height,
    scale: config.scale,
    fullPage: config.fullPage,
    transparent: config.transparent && (config.format === 'png' || config.format === 'webp'),
    backgroundColor: config.backgroundColor,
    quality: config.quality,
    timeoutMs: config.timeoutMs ?? defaultTimeoutMs,
  };
}

export interface RenderOptions {
  /** Reuse a caller-provided browser manager (e.g. tests). */
  browser?: ReturnType<typeof getBrowserManager>;
  /** Extra hosts allowed for URL capture. */
  allowedHosts?: string[];
  /** Hosts always blocked for URL capture. */
  blockedHosts?: string[];
  /** Default per-render timeout when request omits timeoutMs. */
  defaultTimeoutMs?: number;
}

/**
 * Render source code (HTML/CSS/JSX/TSX/Next.js) or a URL to an image.
 *
 * This is the engine's primary programmatic entry point. It is independent of
 * the frontend and returns a predictable result with the image buffer and
 * metadata.
 */
export async function renderToImage(
  input: RenderConfig,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const started = Date.now();
  const config = normalizeConfig(input, options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const manager = options.browser ?? getBrowserManager();

  const context = await manager.createContext();
  try {
    context.setDefaultTimeout(config.timeoutMs);

    let screenshot: Buffer;

    if (config.inputType === 'url') {
      const validated = await validateUrl(config.code, {
        allowedHosts: new Set(options.allowedHosts ?? []),
        blockedHosts: new Set(options.blockedHosts ?? []),
      });
      screenshot = await captureScreenshot(context, {
        width: config.width,
        height: config.height,
        fullPage: config.fullPage,
        timeoutMs: config.timeoutMs,
        transparent: config.transparent,
        url: validated.url.toString(),
      });
    } else {
      let compiled;
      if (config.inputType === 'jsx' || config.inputType === 'tsx' || config.inputType === 'next') {
        compiled = await compileJsx(config.code, {
          loader: config.inputType === 'tsx' || config.inputType === 'next' ? 'tsx' : 'jsx',
          next: config.inputType === 'next',
        });
      }
      const { html } = buildDocument(config, compiled);
      screenshot = await captureScreenshot(context, {
        width: config.width,
        height: config.height,
        fullPage: config.fullPage,
        timeoutMs: config.timeoutMs,
        transparent: config.transparent,
        html,
      });
    }

    const processed = await processImage(screenshot, config);

    return {
      buffer: processed.buffer,
      mimeType: MIME_TYPES[config.format],
      extension: EXTENSIONS[config.format],
      metadata: {
        width: processed.width,
        height: processed.height,
        format: config.format,
        scale: config.scale,
        bytes: processed.buffer.length,
        durationMs: Date.now() - started,
        fullPage: config.fullPage,
        transparent: config.transparent,
      },
    };
  } catch (error) {
    if (error instanceof RenderError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new RenderError('INTERNAL_ERROR', 'Unexpected render failure', message, error);
  } finally {
    manager.releaseContext();
    await context.close().catch(() => undefined);
  }
}