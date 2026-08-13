import path from 'node:path';

import { runCritiqueConformance } from './runner';

const args = process.argv.slice(2);
const outPath = readOption(args, '--out');
const fixturesPath = readOption(args, '--fixtures');
const live = args.includes('--live');
const fixturesRoot = path.resolve(
  process.cwd(),
  fixturesPath ??
    (process.cwd().endsWith('src-api')
      ? 'test/fixtures/design-mode/critique/conformance'
      : 'src-api/test/fixtures/design-mode/critique/conformance'),
);

const report = await runCritiqueConformance({ fixturesRoot, live });
const serialized = JSON.stringify(report, null, 2);
const summary = `${report.summary.passed}/${report.summary.total} critique conformance checks passed`;

if (outPath) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.resolve(process.cwd(), outPath), `${serialized}\n`);
  process.stdout.write(
    `${color(report.summary.failed === 0 ? 'green' : 'red', summary)}\n`,
  );
} else {
  process.stderr.write(
    `${color(report.summary.failed === 0 ? 'green' : 'red', summary)}\n`,
  );
  process.stdout.write(`${serialized}\n`);
}

process.exitCode = report.summary.failed > 0 ? 1 : 0;

function readOption(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function color(kind: 'green' | 'red', value: string) {
  const code = kind === 'green' ? '32' : '31';
  return `\u001b[${code}m${value}\u001b[0m`;
}
