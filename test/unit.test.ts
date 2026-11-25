import { describe, it, expect } from 'vitest';
import { parseRenderConfig } from '../src/engine/validation.js';
import { detectInputType, isFullHtmlDocument, analyzeSource } from '../src/engine/input-parser.js';
import { buildDocument } from '../src/engine/document-builder.js';
import { compileJsx, transformNextFontImports } from '../src/engine/jsx-compiler.js';
import { normalizeConfig } from '../src/engine/render.js';

const base = {
  code: '<h1>Hi</h1>',
  inputType: 'html' as const,
  format: 'png' as const,
  width: 800,
  height: 600,
  scale: 1 as const,
  fullPage: false,
  transparent: false,
  backgroundColor: '#ffffff',
  quality: 90,
};

describe('parseRenderConfig', () => {
  it('accepts a valid config and applies defaults', () => {
    const result = parseRenderConfig({ code: 'x' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.width).toBe(1200);
      expect(result.data.format).toBe('png');
    }
  });

  it('rejects empty code', () => {
    expect(parseRenderConfig({ code: '' }).success).toBe(false);
  });

  it('rejects out-of-range dimensions', () => {
    expect(parseRenderConfig({ code: 'x', width: 10 }).success).toBe(false);
    expect(parseRenderConfig({ code: 'x', width: 99999 }).success).toBe(false);
  });

  it('rejects invalid scale', () => {
    expect(parseRenderConfig({ code: 'x', scale: 4 }).success).toBe(false);
  });

  it('rejects invalid background color', () => {
    expect(parseRenderConfig({ code: 'x', backgroundColor: 'red' }).success).toBe(false);
  });
});

describe('detectInputType', () => {
  it('detects full HTML documents', () => {
    expect(detectInputType('<!DOCTYPE html><html></html>')).toBe('html');
  });
  it('detects CSS', () => {
    expect(detectInputType('.a { color: red; }')).toBe('css');
  });
  it('detects JSX', () => {
    expect(detectInputType('const x = <div>hi</div>;')).toBe('jsx');
  });
  it('detects TSX via interface', () => {
    expect(detectInputType('interface P { a: string }\nconst C = (p: P) => <div/>;')).toBe('tsx');
  });
  it('respects an explicit hint', () => {
    expect(detectInputType('whatever', 'css')).toBe('css');
  });
});

describe('isFullHtmlDocument', () => {
  it('detects documents and fragments', () => {
    expect(isFullHtmlDocument('<!doctype html><html>')).toBe(true);
    expect(isFullHtmlDocument('<div>hi</div>')).toBe(false);
  });
});

describe('analyzeSource', () => {
  it('flags default exports', () => {
    expect(analyzeSource('export default function A(){}', 'jsx').hasDefaultExport).toBe(true);
  });
});

describe('buildDocument', () => {
  it('wraps an HTML fragment', () => {
    const { html } = buildDocument(normalizeConfig(base));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<h1>Hi</h1>');
  });

  it('passes a full HTML document through', () => {
    const cfg = normalizeConfig({ ...base, code: '<!doctype html><html><body>x</body></html>' });
    expect(buildDocument(cfg).html).toBe(cfg.code);
  });

  it('wraps CSS with a showcase and injects style', () => {
    const cfg = normalizeConfig({ ...base, inputType: 'css', code: 'h1{color:red}' });
    const { html } = buildDocument(cfg);
    expect(html).toContain('h1{color:red}');
    expect(html).toContain('rasterly-showcase');
  });

  it('escapes closing script tags in injected code', () => {
    const cfg = normalizeConfig({ ...base, inputType: 'css', code: '</script><script>alert(1)' });
    const { html } = buildDocument(cfg);
    expect(html).not.toContain('</script><script>alert(1)');
  });
});

describe('compileJsx', () => {
  it('compiles JSX to an IIFE bundle exposing a global', async () => {
    const result = await compileJsx('function App(){ return <div>hi</div>; }', { loader: 'jsx' });
    expect(result.code).toContain(result.globalName);
    expect(result.code.length).toBeGreaterThan(100);
  });

  it('compiles TSX with types', async () => {
    const result = await compileJsx(
      'type P = { n: number }; function App(p: P){ return <div>{p.n}</div>; }',
      { loader: 'tsx' },
    );
    expect(result.globalName).toBe('__RasterlyComponent');
  });

  it('throws COMPILATION_ERROR on invalid source', async () => {
    await expect(compileJsx('const = ;', { loader: 'jsx' })).rejects.toMatchObject({
      code: 'COMPILATION_ERROR',
    });
  });

  it('rewrites next/font imports to the runtime helper', () => {
    const out = transformNextFontImports(
      "import { Inter, Roboto } from 'next/font/google';\nimport local from 'next/font/local';",
    );
    expect(out).toContain("__rasterlyFont('google')");
    expect(out).toContain("__rasterlyFont('local')");
    expect(out).not.toContain("from 'next/font");
  });

  it('compiles a Next.js component with next/* shims', async () => {
    const result = await compileJsx(
      `'use client';
       import Image from 'next/image';
       import Link from 'next/link';
       import { Inter } from 'next/font/google';
       export default function Page() {
         const inter = Inter({ subsets: ['latin'] });
         return <div className={inter.className}><Image src="/x.png" width={10} height={10} alt="" /><Link href="/y">go</Link></div>;
       }`,
      { loader: 'tsx', next: true },
    );
    expect(result.code).toContain('__RasterlyComponent');
    expect(result.code).toContain('__rasterlyFont');
  });

  it('bundles imported CSS (incl. CSS modules) into result.css', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'rasterly-css-'));
    try {
      await writeFile(join(dir, 'globals.css'), '.globals { color: rgb(1, 2, 3); }');
      await writeFile(join(dir, 'card.module.css'), '.card { color: rgb(4, 5, 6); }');
      const result = await compileJsx(
        `import './globals.css';
         import s from './card.module.css';
         export default function C(){ return <div className={s.card}>x</div>; }`,
        { loader: 'tsx', next: true, resolveDir: dir },
      );
      expect(result.css).toContain('color: rgb(1, 2, 3)');
      expect(result.css).toContain('color: rgb(4, 5, 6)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('normalizeConfig timeout precedence', () => {
  it('uses engine default timeout when request and default are absent', () => {
    const config = normalizeConfig({ ...base });
    expect(config.timeoutMs).toBe(30_000);
  });

  it('uses provided default timeout when request timeout is absent', () => {
    const config = normalizeConfig({ ...base }, 45_000);
    expect(config.timeoutMs).toBe(45_000);
  });

  it('prefers per-request timeout over provided default', () => {
    const config = normalizeConfig({ ...base, timeoutMs: 5_000 }, 45_000);
    expect(config.timeoutMs).toBe(5_000);
  });
});
