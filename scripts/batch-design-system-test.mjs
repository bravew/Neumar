import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const templatesRoot = path.join(
  repoRoot,
  'src-api/src/shared/design-mode/prompt-templates',
);

const args = process.argv.slice(2);
const systemId = args.find((arg) => !arg.startsWith('--'));
if (!systemId) {
  console.error(
    'Usage: pnpm batch:design-system <system-id> [--prompt <file>] [--out <dir>] [--dry-run] [--timeout-s 600]',
  );
  process.exit(1);
}

const options = parseOptions(args);
const outRoot = path.resolve(
  repoRoot,
  options.out ?? `tmp/batch-design-system/${systemId}/${timestamp()}`,
);
const promptFiles = options.prompt
  ? [path.resolve(repoRoot, options.prompt)]
  : await listPromptFiles(templatesRoot);

await mkdir(outRoot, { recursive: true });

for (const promptFile of promptFiles) {
  const prompt = await readFile(promptFile, 'utf8');
  const parsed = JSON.parse(prompt);
  const id = path.basename(promptFile, path.extname(promptFile));
  const target = path.join(outRoot, id);
  await mkdir(target, { recursive: true });
  const resolvedPrompt = [
    `Design system: ${systemId}`,
    `Prompt template: ${parsed.title ?? id}`,
    '',
    parsed.prompt ?? prompt,
  ].join('\n');
  await writeFile(path.join(target, 'resolved-prompt.md'), resolvedPrompt);
  const run = {
    systemId,
    promptFile: path.relative(repoRoot, promptFile),
    dryRun: options.dryRun,
    timeoutSeconds: options.timeoutSeconds,
    status: options.dryRun ? 'dry-run' : 'skipped',
    assistantRunId: options.dryRun
      ? null
      : (process.env.DESIGNMODE_BATCH_ASSISTANT_RUN_ID ?? null),
    output: options.dryRun
      ? 'Dry run: provider calls skipped.'
      : 'Live batch execution requires the desktop agent runtime; this script persisted the prompt for replay.',
    writtenAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(target, 'run.json'),
    `${JSON.stringify(run, null, 2)}\n`,
  );
}

console.log(
  `Batch design-system ${options.dryRun ? 'dry run' : 'prompt export'} wrote ${
    promptFiles.length
  } prompt(s) to ${path.relative(repoRoot, outRoot)}`,
);

function parseOptions(values) {
  const parsed = {
    dryRun: false,
    timeoutSeconds: 600,
    out: undefined,
    prompt: undefined,
  };
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === '--dry-run') parsed.dryRun = true;
    if (value === '--out') parsed.out = values[++index];
    if (value === '--prompt') parsed.prompt = values[++index];
    if (value === '--timeout-s') {
      parsed.timeoutSeconds = Number(values[++index] ?? parsed.timeoutSeconds);
    }
  }
  return parsed;
}

async function listPromptFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPromptFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
