import { detectInputType, parseRenderConfig } from '../engine/index.js';
import type { InputType, RenderConfig } from '../engine/index.js';

export const CLI_INPUT_TYPES = ['html', 'css', 'jsx', 'tsx', 'next', 'url'] as const;
export type CliInputType = (typeof CLI_INPUT_TYPES)[number];

export interface CliValues {
  output?: string;
  format?: string;
  'input-type'?: string;
  width?: string;
  height?: string;
  scale?: string;
  background?: string;
  transparent?: boolean;
  'full-page'?: boolean;
  quality?: string;
  timeout?: string;
  stdin?: boolean;
  help?: boolean;
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function isParseArgsError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string' &&
    (error as NodeJS.ErrnoException).code!.startsWith('ERR_PARSE_ARGS_')
  );
}

export function formatParseArgsError(error: unknown): string {
  if (isParseArgsError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function parseIntegerArg(name: string, value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new CliError(`Invalid ${name}: "${value}" is not an integer`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new CliError(`Invalid ${name}: "${value}" is not a safe integer`);
  }
  return parsed;
}

export function inferInputTypeFromPath(filePath: string): InputType | undefined {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.tsx')) return 'tsx';
  return undefined;
}

export function validateInputType(value: string): InputType {
  if ((CLI_INPUT_TYPES as readonly string[]).includes(value)) return value as InputType;
  throw new CliError(
    `Invalid --input-type: "${value}". Expected one of: ${CLI_INPUT_TYPES.join(', ')}`,
  );
}

export function resolveInputType(options: {
  explicitType?: string;
  stdin: boolean;
  target: string;
  code: string;
}): InputType {
  const { explicitType, stdin, target, code } = options;
  if (explicitType != null) {
    return validateInputType(explicitType);
  }
  if (!stdin && /^https?:\/\//i.test(target)) {
    return 'url';
  }
  if (!stdin) {
    const fromPath = inferInputTypeFromPath(target);
    if (fromPath) return fromPath;
  }
  return detectInputType(code);
}

export function buildRenderConfig(values: CliValues, code: string, inputType: InputType): RenderConfig {
  const width = parseIntegerArg('--width', values.width, 1200);
  const height = parseIntegerArg('--height', values.height, 800);
  const scale = parseIntegerArg('--scale', values.scale, 1);
  const quality = parseIntegerArg('--quality', values.quality, 90);
  const timeoutMs =
    values.timeout == null ? undefined : parseIntegerArg('--timeout', values.timeout, 30_000);

  const candidate = {
    code,
    inputType,
    format: values.format ?? 'png',
    width,
    height,
    scale,
    fullPage: values['full-page'] ?? false,
    transparent: values.transparent ?? false,
    backgroundColor: values.background ?? '#ffffff',
    quality,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };

  const parsed = parseRenderConfig(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      })
      .join('; ');
    throw new CliError(`Invalid render configuration: ${issues}`);
  }
  return parsed.data;
}
