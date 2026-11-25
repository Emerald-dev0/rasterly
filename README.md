# Rasterly

**Rasterly** turns source code into crisp images. Write HTML, CSS, React, JSX, TSX or a Next.js component — or point it at a URL — and export a pixel-perfect PNG, JPEG or WebP rendered in a real Chromium browser.

It is a small, self-hostable web app plus a reusable rendering engine and a CLI. No placeholders, no fake previews: every image is produced by an actual headless browser and post-processed with Sharp.

```
┌────────────────────────────┐   ┌────────────────────────────┐
│  Source code (editor)      │   │  Live preview              │
│  HTML · CSS · JSX · TSX · Next │ → │  zoom · fit · checkerboard │
│  or a URL                  │   │  dimensions · metadata     │
└────────────────────────────┘   └────────────────────────────┘
            │                                │
            └──────────►  Render  ◄──────────┘
                     Playwright + Chromium
                              │
                        Sharp (resize/encode)
                              │
                     PNG · JPEG · WebP  →  download
```

## Features

- **Code editor** (CodeMirror 6) with syntax highlighting for HTML, CSS, JSX, TSX and Next.js, sensible starter examples, `⌘/Ctrl+Enter` to render, copy/paste and autocomplete.
- **Real rendering engine** — determines input type, compiles JSX/TSX/Next.js with esbuild, builds a document, renders in isolated Chromium contexts, waits for fonts/images/first paint (no arbitrary fixed delays), captures, and encodes with Sharp.
- **Next.js support** — a dedicated `next` input type that understands `next/image`, `next/link`, `next/head`, `next/script`, `next/router`, `next/navigation`, `next/dynamic`, `next/document`, `next/config`, `next/font/google` and `next/font/local`, the `'use client'` directive, tsconfig path aliases (`@/*`, `~/*`), and CSS / CSS-module imports (injected into the render). `next/font/google` families are loaded at render time via Google Fonts.
- **Live preview** with zoom (fit / 50% / 100% / 200%), checkerboard for transparency, dimension + size + timing metadata, loading and error states.
- **Export controls**: format, width/height, scale (1×/2×/3×), background color, transparent background, quality (lossy), full-page capture.
- **URL-to-image** with SSRF protection (blocks private/internal IPs, non-http(s) protocols, and configurable hosts), navigation timeouts and per-request network guards.
- **Reusable engine** with a clean programmatic API (`renderToImage`) independent of the frontend.
- **CLI** for scripting and CI.
- **Security-minded**: strict Zod validation, request size limits, execution timeouts, per-job browser context isolation, restricted network access, and no server-side file access from submitted code.

## Quick start

```bash
# 1. Install dependencies (also downloads Chromium for Playwright)
npm install

# 2. Copy env defaults (optional)
cp .env.example .env

# 3. Run the web app (server + Vite dev server)
npm run dev
# → open http://localhost:5173
```

The dev server proxies `/api` to the backend on `http://127.0.0.1:8787`.

### Production build

```bash
npm run build      # builds engine/server (tsc) and frontend (vite)
npm start          # serves API + built frontend on http://127.0.0.1:8787
```

## CLI usage

```bash
# Render a file
npx tsx src/cli/index.ts page.html -o out.png -f png -w 1200 --height 800

# Render JSX/TSX from stdin at 2× scale
cat component.tsx | npx tsx src/cli/index.ts --stdin -t tsx -s 2 -o comp.png

# Capture a URL (SSRF-protected)
npx tsx src/cli/index.ts https://example.com --full-page -o site.webp -f webp
```

Run `npx tsx src/cli/index.ts --help` for all options. After `npm run build` the CLI is available as `node dist/cli/index.js` (or `npx rasterly` when installed).

## Programmatic API

The engine is framework-agnostic and returns a predictable result.

```ts
import { renderToImage, closeSharedBrowser } from 'rasterly'; // or from './src/engine/index.js'

const result = await renderToImage({
  code: '<h1 style="color:#5b8cff">Hello</h1>',
  inputType: 'html',        // 'html' | 'css' | 'jsx' | 'tsx' | 'next' | 'url'
  format: 'png',            // 'png' | 'jpeg' | 'webp'
  width: 1200,
  height: 800,
  scale: 2,
  fullPage: false,
  transparent: false,
  backgroundColor: '#0f0f12',
  quality: 90,
});

result.buffer;     // Node.js Buffer of the encoded image
result.mimeType;   // e.g. 'image/png'
result.extension;  // 'png' | 'jpg' | 'webp'
result.metadata;   // { width, height, format, scale, bytes, durationMs, fullPage, transparent }

await closeSharedBrowser(); // release the shared Chromium process
```

A runnable example lives in [`examples/programmatic.ts`](./examples/programmatic.ts).

### Rendering Next.js components

Use `inputType: 'next'` to render a single Next.js page/component. The compiler resolves `next/*` imports to browser-safe shims, loads `next/font` families, applies tsconfig path aliases, and injects imported CSS.

```ts
const result = await renderToImage({
  inputType: 'next',
  format: 'png',
  width: 1200,
  height: 800,
  scale: 2,
  fullPage: false,
  transparent: false,
  backgroundColor: '#0f0f12',
  quality: 90,
  code: `
    'use client';
    import Image from 'next/image';
    import { Inter } from 'next/font/google';
    export default function Page() {
      const inter = Inter({ subsets: ['latin'] });
      return (
        <main className={inter.className}>
          <h1>Hello from Next</h1>
          <Image src="/logo.png" width={64} height={64} alt="logo" />
        </main>
      );
    }`,
});
```

**Next.js support scope:** it renders a single component/page, not a full Next app. Supported: `next/image`, `next/link`, `next/head`, `next/script`, `next/router`, `next/navigation`, `next/dynamic`, `next/document`, `next/config`, `next/font/google`, `next/font/local`, `'use client'`, tsconfig `paths` aliases, and `import './x.css'` / `*.module.css`. Not supported: server components running on the server, `next/og` `ImageResponse`, route handlers, middleware, and cross-file module graphs beyond relative/aliased imports (the entry is compiled with `resolveDir` = current working directory, so run the CLI from your project root to resolve local imports and `tsconfig.json`).

## HTTP API

`POST /api/render`

```jsonc
{
  "code": "<h1>Hi</h1>",
  "inputType": "html",
  "format": "png",
  "width": 1200,
  "height": 800,
  "scale": 1,
  "fullPage": false,
  "transparent": false,
  "backgroundColor": "#ffffff",
  "quality": 90
}
```

Returns the image bytes with `Content-Type` set to the image MIME type and an `X-Rasterly-Metadata` header containing JSON metadata. Errors return `{ "error": "<CODE>", "message": "...", "detail": "..." }` with an appropriate status (`400` invalid input, `403` SSRF/disabled, `422` compilation, `504` timeout, `500` other).

`GET /api/health` → `{ "status": "ok", "version": "1.0.0" }`

### Example with curl

```bash
curl -s -X POST http://127.0.0.1:8787/api/render \
  -H 'Content-Type: application/json' \
  -d '{"code":"<h1>Hi</h1>","inputType":"html","format":"png","width":600,"height":300,"scale":1,"fullPage":false,"transparent":false,"backgroundColor":"#ffffff","quality":90}' \
  -o out.png
```

## Architecture

The rendering engine is fully decoupled from the frontend and lives in `src/engine`.

```
src/
  engine/                 # reusable, frontend-independent rendering engine
    types.ts              # public types + MIME/extension maps
    validation.ts         # Zod schemas for untrusted input
    input-parser.ts       # input-type detection + source analysis
    jsx-compiler.ts       # esbuild JSX/TSX/Next → IIFE bundle (React + next/* shims, CSS)
    document-builder.ts   # HTML document construction (fragments, CSS, React mount)
    browser.ts            # Chromium lifecycle + isolated context pool
    screenshot.ts         # navigation, network guard, wait strategy, capture
    image-processor.ts    # Sharp resize / flatten / encode
    ssrf.ts               # URL + DNS validation against private/internal ranges
    errors.ts             # typed RenderError hierarchy
    render.ts             # renderToImage orchestrator (public API)
    index.ts              # public exports
  server/                 # Express API (Zod validation, static frontend, error mapping)
  frontend/               # React + TS + Tailwind + CodeMirror SPA
    components/           # Header, SettingsBar, CodeEditor, PreviewPanel
    lib/                  # api client + starter examples
  cli/                    # rasterly CLI
test/                     # unit + integration tests (Vitest)
examples/                 # programmatic usage
```

**Rendering pipeline:** `renderToImage` → normalize/validate config → (compile JSX | build document | validate URL) → isolated browser context → navigate/`setContent` → wait for `document.fonts.ready`, image decode and two animation frames + bounded network idle → `page.screenshot` → Sharp (flatten/resize/encode) → `RenderResult`.

The browser is a shared, lazily-launched Chromium process that hands out isolated contexts (bounded by `RENDER_CONCURRENCY`); every context is closed in a `finally` block.

## Configuration

Copy `.env.example` to `.env` and adjust. All variables are optional.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Backend port |
| `HOST` | `127.0.0.1` | Bind address |
| `CHROMIUM_EXECUTABLE_PATH` | _(bundled)_ | Use an existing Chromium/Chrome binary instead of Playwright's |
| `CHROMIUM_NO_SANDBOX` | `false` | Pass `--no-sandbox` (needed in some rootless/container environments) |
| `RENDER_CONCURRENCY` | `4` | Max concurrent render browser contexts. Requests above the limit are rejected. Valid positive integer. |
| `RENDER_TIMEOUT_MS` | `30000` | Default per-render timeout in milliseconds when request omits `timeoutMs`. Per-request `timeoutMs` overrides this value. Valid integer: 1000-120000. |
| `MAX_REQUEST_BYTES` | `2mb` | Max JSON body size |
| `ENABLE_URL_CAPTURE` | `true` | Allow the URL-to-image feature |
| `URL_ALLOWED_HOSTS` | _(empty)_ | Extra comma-separated hosts allowed for URL capture |
| `URL_BLOCKED_HOSTS` | _(empty)_ | Comma-separated hosts always blocked |

> The engine reads `CHROMIUM_EXECUTABLE_PATH` and `CHROMIUM_NO_SANDBOX` directly; the server reads the rest.

## Security considerations

Rasterly renders **untrusted** code and URLs, so it is built to contain that risk:

- **Isolation** — submitted code never runs in the backend process. It runs only inside a headless Chromium page, one isolated context per job, always closed afterward.
- **SSRF protection** — URL capture rejects non-`http(s)` protocols, literal and DNS-resolved private/loopback/link-local/multicast addresses, `localhost`, and configured blocked hosts. Redirects and subresources pass a network guard that aborts private/literal-internal targets and caps unique hosts.
- **Validation** — every request is validated with Zod (types, ranges, hex colors, size). Body size is capped.
- **Resource limits** — per-job execution timeouts, bounded context concurrency, and bounded waits (no unbounded `networkidle`).
- **No server file access** — submitted code cannot read the server filesystem; only the CLI reads local files, and only from its own arguments.
- **Safe rendering** — the document builder escapes `</script>` in injected CSS to prevent premature script termination.

**Limitations you must understand before exposing this publicly:**

- A browser is a powerful sandbox but not a security boundary against a determined attacker. Malicious pages can still consume CPU/memory, attempt to exploit Chromium, or exfiltrate data to allowed external hosts. Run Rasterly behind authentication, rate limiting, and OS/container sandboxing (e.g. a locked-down `--no-sandbox` container, seccomp, read-only FS) if it is internet-facing.
- URL capture can reach any **public** host; combined with open redirects this can be abused for traffic amplification. Keep `ENABLE_URL_CAPTURE=false` if you do not need it.
- DNS-rebinding between the initial validation and subresource fetches is mitigated but not eliminated; the network guard re-checks literal private targets on every request.

## Testing

```bash
npm test          # unit + integration (Vitest)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

The suite (55 tests) covers HTML/CSS/JSX/TSX/Next.js rendering, PNG/JPEG/WebP export, custom dimensions, scale factors, transparent alpha, full-page capture, Next.js shims/`next/font`/CSS modules, compilation errors, invalid inputs, SSRF blocking and browser-context cleanup. Integration tests drive the real Playwright + Sharp pipeline.

## Project status / known limitations

- Full-page capture uses the viewport width; very wide pages may need a larger `width`.
- External fonts/images load only when the network guard permits the host; offline renders fall back to system fonts.
- `scale` enlarges the captured bitmap (it does not re-render at a higher device pixel ratio), which is ideal for crisp exports but is a resize rather than a true HiDPI re-raster.
- URL capture is best-effort for dynamic pages; pages requiring interaction will not be scripted.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Good first issues: more starter examples, additional wait strategies, Docker packaging, and a Playwright trace viewer.

## License

[MIT](./LICENSE) © Rasterly contributors.