#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToImage, RenderError, closeSharedBrowser } from '../engine/index.js';
import {
  buildRenderConfig,
  CliError,
  formatParseArgsError,
  resolveInputType,
  type CliValues,
} from './args.js';

const HELP = `
Rasterly — convert code to an image.

Usage:
  rasterly <file|url> [options]
  cat code.tsx | rasterly --stdin [options]

Options:
  -o, --output <path>     Output file (default: rasterly.<ext>)
  -f, --format <fmt>      png | jpeg | webp (default: png)
  -t, --input-type <t>    html | css | jsx | tsx | next | url (default: auto)
  -w, --width <px>        Viewport width (default: 1200)
      --height <px>       Viewport height (default: 800)
  -s, --scale <1|2|3>     Device scale factor (default: 1)
  -b, --background <hex>  Background color (default: #ffffff)
      --transparent       Transparent background (png/webp)
      --full-page         Capture the full scrollable page
  -q, --quality <1-100>   Quality for jpeg/webp (default: 90)
      --timeout <ms>      Render timeout (default: 30000)
      --stdin             Read code from stdin
  -h, --help              Show this help
`.trim();

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      'input-type': { type: 'string', short: 't' },
      width: { type: 'string', short: 'w' },
      height: { type: 'string' },
      scale: { type: 'string', short: 's' },
      background: { type: 'string', short: 'b' },
      transparent: { type: 'boolean', default: false },
      'full-page': { type: 'boolean', default: false },
      quality: { type: 'string', short: 'q' },
      timeout: { type: 'string' },
      stdin: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });
  return { values: values as CliValues, positionals };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let values: CliValues;
  let positionals: string[];
  try {
    ({ values, positionals } = parse(process.argv.slice(2)));
  } catch (error) {
    console.error(`Error: ${formatParseArgsError(error)}`);
    console.error('Use --help for usage.');
    process.exitCode = 1;
    return;
  }

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.stdin && positionals.length > 0) {
    console.error('Error: Cannot use --stdin with a file/URL positional argument.');
    console.error('Use --help for usage.');
    process.exitCode = 1;
    return;
  }
  if (!values.stdin && positionals.length === 0) {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const target = values.stdin ? '' : positionals[0];
  let code: string;
  try {
    code = values.stdin ? await readStdin() : target.startsWith('http://') || target.startsWith('https://') ? target : await readFile(resolve(target), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: Failed to read input: ${message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const inputType = resolveInputType({
      explicitType: values['input-type'],
      stdin: Boolean(values.stdin),
      target,
      code,
    });
    const config = buildRenderConfig(values, code, inputType);

    const result = await renderToImage(config);
    const ext = result.extension;
    const out = values.output ?? `rasterly.${ext}`;
    await writeFile(resolve(out), result.buffer);
    console.log(
      `Rendered ${result.metadata.width}x${result.metadata.height} ${result.mimeType} ` +
        `(${result.metadata.bytes} bytes) -> ${out}`,
    );
  } catch (error) {
    if (error instanceof CliError) {
      console.error(`Error: ${error.message}`);
      console.error('Use --help for usage.');
    } else if (error instanceof RenderError) {
      console.error(`Error [${error.code}]: ${error.message}`);
      if (error.detail) console.error(`  ${error.detail}`);
    } else {
      console.error('Unexpected error:', error);
    }
    process.exitCode = 1;
  } finally {
    await closeSharedBrowser();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exitCode = 1;
});
