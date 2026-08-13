#!/usr/bin/env node
/**
 * `pnpm plugin:new <name>` — scaffold a new neuma plugin from a template.
 *
 * Usage:
 *   pnpm plugin:new my-plugin
 *   pnpm plugin:new my-plugin --template with-script
 *   pnpm plugin:new my-plugin --dir /tmp/plugins --template with-mcp
 *
 * Writes user-facing output to stdout/stderr directly (this is a CLI tool,
 * not a service); no logger needed.
 */

import { homedir } from 'os';
import { join } from 'path';

import { APP_DIR_NAME } from '@/config/constants';

import { createPlugin, type PluginTemplate } from '@/shared/plugins/scaffold';

interface ParsedArgs {
  name: string;
  dir: string;
  template: PluginTemplate;
}

const VALID_TEMPLATES: ReadonlySet<PluginTemplate> = new Set([
  'basic',
  'with-script',
  'with-mcp',
]);

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

function defaultDir(): string {
  return join(homedir(), APP_DIR_NAME, 'plugins');
}

function printUsageAndExit(code: number): never {
  err(
    [
      'Usage: pnpm plugin:new <name> [--dir <path>] [--template basic|with-script|with-mcp]',
      '',
      `  --dir       defaults to ${defaultDir()}`,
      '  --template  defaults to "basic"',
    ].join('\n'),
  );
  process.exit(code);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    printUsageAndExit(args.length === 0 ? 1 : 0);
  }
  const name = args[0]!;
  let dir = defaultDir();
  let template: PluginTemplate = 'basic';
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dir') {
      const next = args[++i];
      if (!next) {
        err('--dir requires a value');
        process.exit(1);
      }
      dir = next;
    } else if (arg === '--template') {
      const next = args[++i];
      if (!next || !VALID_TEMPLATES.has(next as PluginTemplate)) {
        err(`--template must be one of: ${[...VALID_TEMPLATES].join(', ')}`);
        process.exit(1);
      }
      template = next as PluginTemplate;
    } else {
      err(`Unknown argument: ${arg}`);
      printUsageAndExit(1);
    }
  }
  return { name, dir, template };
}

async function main(): Promise<void> {
  const { name, dir, template } = parseArgs(process.argv);
  try {
    const result = await createPlugin({ name, dir, template });
    out(`Created plugin at ${result.pluginDir}`);
    out(`Manifest: ${result.manifestPath}`);
    out(
      `\nNext: edit SKILL.md, then install via the desktop app or:\n` +
        `  curl -X POST http://localhost:2620/plugins/install \\\n` +
        `    -H 'Content-Type: application/json' \\\n` +
        `    -d '{"source":"local","ref":"${result.pluginDir}"}'`,
    );
  } catch (e) {
    err(`Failed to scaffold plugin: ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();
