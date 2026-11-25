import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  buildRenderConfig,
  CliError,
  inferInputTypeFromPath,
  parseIntegerArg,
  resolveInputType,
} from '../src/cli/args.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const repoRoot = resolve(__dirname, '..');
const cliPath = resolve(repoRoot, 'src/cli/index.ts');

function runCli(args: string[], input?: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: repoRoot,
    input,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('CLI arg helpers', () => {
  it('infers input type from known extensions', () => {
    expect(inferInputTypeFromPath('page.html')).toBe('html');
    expect(inferInputTypeFromPath('page.HTM')).toBe('html');
    expect(inferInputTypeFromPath('styles.css')).toBe('css');
    expect(inferInputTypeFromPath('component.jsx')).toBe('jsx');
    expect(inferInputTypeFromPath('component.tsx')).toBe('tsx');
  });

  it('returns undefined for unknown extensions', () => {
    expect(inferInputTypeFromPath('file.txt')).toBeUndefined();
    expect(inferInputTypeFromPath('file.ts')).toBeUndefined();
    expect(inferInputTypeFromPath('file')).toBeUndefined();
  });

  it('parses integer args and rejects invalid integers', () => {
    expect(parseIntegerArg('--width', undefined, 1200)).toBe(1200);
    expect(parseIntegerArg('--width', '800', 1200)).toBe(800);
    expect(() => parseIntegerArg('--width', 'abc', 1200)).toThrow(CliError);
    expect(() => parseIntegerArg('--width', '1.5', 1200)).toThrow(CliError);
  });

  it('resolves explicit input type', () => {
    expect(
      resolveInputType({ explicitType: 'tsx', stdin: false, target: 'file.txt', code: '<div/>' }),
    ).toBe('tsx');
  });

  it('rejects invalid explicit input type', () => {
    expect(() =>
      resolveInputType({ explicitType: 'nope', stdin: false, target: 'file.txt', code: 'x' }),
    ).toThrow(/Invalid --input-type/);
  });

  it('auto-detects URL targets', () => {
    expect(
      resolveInputType({
        explicitType: undefined,
        stdin: false,
        target: 'https://example.com',
        code: 'https://example.com',
      }),
    ).toBe('url');
  });

  it('uses file extension before content detection', () => {
    expect(
      resolveInputType({
        explicitType: undefined,
        stdin: false,
        target: 'component.tsx',
        code: 'body { color: red; }',
      }),
    ).toBe('tsx');
  });

  it('falls back to detectInputType for unknown file extensions', () => {
    expect(
      resolveInputType({
        explicitType: undefined,
        stdin: false,
        target: 'snippet.txt',
        code: 'export default function A(){ return <div>hi</div> }',
      }),
    ).toBe('jsx');
  });

  it('uses detectInputType for stdin when no explicit type is provided', () => {
    expect(
      resolveInputType({
        explicitType: undefined,
        stdin: true,
        target: '',
        code: '.a { color: red; }',
      }),
    ).toBe('css');
  });
});

describe('CLI option validation (schema-reused)', () => {
  it('accepts valid boundary values', () => {
    const config = buildRenderConfig(
      {
        format: 'webp',
        width: '16',
        height: '8192',
        scale: '3',
        quality: '1',
        timeout: '120000',
        background: '#abc',
      },
      '<h1>ok</h1>',
      'html',
    );
    expect(config.format).toBe('webp');
    expect(config.width).toBe(16);
    expect(config.height).toBe(8192);
    expect(config.scale).toBe(3);
    expect(config.quality).toBe(1);
    expect(config.timeoutMs).toBe(120000);
    expect(config.backgroundColor).toBe('#abc');
  });

  it('accepts other valid boundary values', () => {
    const config = buildRenderConfig(
      {
        format: 'jpeg',
        width: '8192',
        height: '16',
        scale: '1',
        quality: '100',
        timeout: '1000',
        background: '#AABBCCDD',
      },
      '<h1>ok</h1>',
      'html',
    );
    expect(config.format).toBe('jpeg');
    expect(config.width).toBe(8192);
    expect(config.height).toBe(16);
    expect(config.scale).toBe(1);
    expect(config.quality).toBe(100);
    expect(config.timeoutMs).toBe(1000);
    expect(config.backgroundColor).toBe('#AABBCCDD');
  });

  it('rejects invalid format', () => {
    expect(() => buildRenderConfig({ format: 'gif' }, '<h1>ok</h1>', 'html')).toThrow(CliError);
  });

  it('rejects invalid width and height', () => {
    expect(() => buildRenderConfig({ width: '15' }, '<h1>ok</h1>', 'html')).toThrow(/width/);
    expect(() => buildRenderConfig({ width: '8193' }, '<h1>ok</h1>', 'html')).toThrow(/width/);
    expect(() => buildRenderConfig({ height: '0' }, '<h1>ok</h1>', 'html')).toThrow(/height/);
    expect(() => buildRenderConfig({ height: '9000' }, '<h1>ok</h1>', 'html')).toThrow(/height/);
  });

  it('rejects invalid scale', () => {
    expect(() => buildRenderConfig({ scale: '0' }, '<h1>ok</h1>', 'html')).toThrow(/scale/);
    expect(() => buildRenderConfig({ scale: '4' }, '<h1>ok</h1>', 'html')).toThrow(/scale/);
  });

  it('rejects invalid quality', () => {
    expect(() => buildRenderConfig({ quality: '0' }, '<h1>ok</h1>', 'html')).toThrow(/quality/);
    expect(() => buildRenderConfig({ quality: '101' }, '<h1>ok</h1>', 'html')).toThrow(/quality/);
  });

  it('rejects invalid timeout', () => {
    expect(() => buildRenderConfig({ timeout: '999' }, '<h1>ok</h1>', 'html')).toThrow(/timeoutMs/);
    expect(() => buildRenderConfig({ timeout: '120001' }, '<h1>ok</h1>', 'html')).toThrow(/timeoutMs/);
  });

  it('rejects invalid background color', () => {
    expect(() => buildRenderConfig({ background: 'red' }, '<h1>ok</h1>', 'html')).toThrow(/backgroundColor/);
    expect(() => buildRenderConfig({ background: '#ggg' }, '<h1>ok</h1>', 'html')).toThrow(/backgroundColor/);
    expect(() => buildRenderConfig({ background: '123456' }, '<h1>ok</h1>', 'html')).toThrow(/backgroundColor/);
  });
});

describe('CLI process behavior', () => {
  it('prints help and exits 0', () => {
    const res = runCli(['--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Rasterly — convert code to an image.');
    expect(res.stdout).toContain('--input-type');
  });

  it('returns clean error for unknown options', () => {
    const res = runCli(['--nope']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Error:');
    expect(res.stderr).toContain('Unknown option');
    expect(res.stderr).toContain('Use --help for usage.');
    expect(res.stderr).not.toContain('TypeError');
  });

  it('returns clean error for missing option value', () => {
    const res = runCli(['--format']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Error:');
    expect(res.stderr).toContain('argument missing');
    expect(res.stderr).not.toContain('TypeError');
  });

  it('rejects conflicting --stdin and positional argument', () => {
    const res = runCli(['--stdin', 'input.html'], '<h1>Hi</h1>');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Cannot use --stdin with a file/URL positional argument');
  });

  it('rejects invalid explicit input type', () => {
    const res = runCli(['--stdin', '-t', 'nope'], '<h1>Hi</h1>');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid --input-type');
  });

  it('rejects invalid format option', () => {
    const res = runCli(['--stdin', '--format', 'gif'], '<h1>Hi</h1>');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid render configuration');
    expect(res.stderr).toContain('format');
  });

  it('rejects invalid width, height, scale, quality, timeout, and background', () => {
    const width = runCli(['--stdin', '--width', '15'], '<h1>Hi</h1>');
    expect(width.status).toBe(1);
    expect(width.stderr).toContain('width');

    const height = runCli(['--stdin', '--height', '8193'], '<h1>Hi</h1>');
    expect(height.status).toBe(1);
    expect(height.stderr).toContain('height');

    const scale = runCli(['--stdin', '--scale', '5'], '<h1>Hi</h1>');
    expect(scale.status).toBe(1);
    expect(scale.stderr).toContain('scale');

    const quality = runCli(['--stdin', '--quality', '101'], '<h1>Hi</h1>');
    expect(quality.status).toBe(1);
    expect(quality.stderr).toContain('quality');

    const timeout = runCli(['--stdin', '--timeout', '999'], '<h1>Hi</h1>');
    expect(timeout.status).toBe(1);
    expect(timeout.stderr).toContain('timeoutMs');

    const bg = runCli(['--stdin', '--background', 'red'], '<h1>Hi</h1>');
    expect(bg.status).toBe(1);
    expect(bg.stderr).toContain('backgroundColor');
  });

  it('auto-detects tsx file extension before validation/render (deterministic, no browser)', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'rasterly-cli-'));
    const file = resolve(dir, 'component.tsx');
    writeFileSync(file, 'export default function A(){ return <div>hi</div> }');
    const res = runCli([file, '--scale', '5']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid render configuration');
    expect(res.stderr).toContain('scale');
    expect(res.stderr).not.toContain('Invalid --input-type');
  });

  it('auto-detects stdin content type before validation/render (deterministic, no browser)', () => {
    const res = runCli(['--stdin', '--quality', '101'], '.a { color: red; }');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid render configuration');
    expect(res.stderr).toContain('quality');
    expect(res.stderr).not.toContain('Invalid --input-type');
  });
});