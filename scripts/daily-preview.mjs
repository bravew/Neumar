#!/usr/bin/env node
import {
  artifactBaseName,
  checkChecksums,
  decidePlan,
  evaluateCiGate,
  isFullSha,
  nextPointer,
  parsePointer,
} from './lib/daily-preview.mjs';

/**
 * CLI for `.github/workflows/daily-preview.yml` (#366). All decisions live in
 * `scripts/lib/daily-preview.mjs`; this file only does I/O.
 *
 *   plan            decide build / no-change / abort for a frozen main SHA
 *   write-manifest  write preview-manifest.json for the staged artifact
 *   write-sums      write SHA256SUMS for every staged file
 *   verify-artifact check a downloaded artifact against SHA256SUMS + manifest
 *   next-pointer    compute the next last-good pointer (verified builds only)
 *
 * Any failed or incomplete read exits non-zero. It never counts as "no change".
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  appendFile,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const SUMS_FILE = 'SHA256SUMS';
const MANIFEST_FILE = 'preview-manifest.json';

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`expected "--name value" pairs, got "${key ?? ''}"`);
    }
    flags[key.slice(2)] = value;
  }
  return flags;
}

function required(flags, name) {
  const value = flags[name];
  if (value === undefined || value === '') {
    throw new Error(`missing --${name}`);
  }
  return value;
}

/** `none` is the explicit bootstrap marker; anything else must be readable. */
async function readPointerFlag(value) {
  if (value === 'none') return null;
  return parsePointer(await readFile(value, 'utf8'));
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function hashDirectory(dir) {
  const hashes = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      throw new Error(`unexpected non-file entry in artifact: ${entry.name}`);
    }
    if (entry.name === SUMS_FILE) continue;
    hashes[entry.name] = await sha256(path.join(dir, entry.name));
  }
  return hashes;
}

async function emitOutputs(outputs) {
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
}

async function summarize(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

function fetchCheckRuns(repo, sha) {
  const endpoint = `repos/${repo}/commits/${sha}/check-runs?check_name=CI%20Gate&filter=all&per_page=100`;
  const body = execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(body);
}

async function plan(flags) {
  const candidateSha = required(flags, 'candidate');
  const date = required(flags, 'date');
  const pointer = await readPointerFlag(required(flags, 'pointer'));
  const lastGoodSha = pointer?.sha ?? null;

  // Only ask GitHub when main moved. An unchanged main needs no API read.
  let ci;
  if (lastGoodSha !== candidateSha) {
    try {
      ci = evaluateCiGate(
        fetchCheckRuns(required(flags, 'repo'), candidateSha),
        candidateSha,
      );
    } catch (error) {
      ci = {
        ok: false,
        state: 'unknown',
        detail: `could not read check runs: ${error.message}`,
      };
    }
  }

  const result = decidePlan({ candidateSha, lastGoodSha, ci });
  await emitOutputs({
    action: result.action,
    reason: result.reason,
    range: result.range,
    candidate_sha: candidateSha,
    last_good_sha: lastGoodSha ?? 'none',
    artifact_name: artifactBaseName({ date, sha: candidateSha }),
  });
  await summarize(
    [
      '### Daily preview plan',
      `- Candidate: \`${candidateSha}\``,
      `- Last good: \`${lastGoodSha ?? 'none'}\``,
      `- Range: \`${result.range}\``,
      `- Decision: **${result.action}** (${result.reason})`,
    ].join('\n'),
  );
  if (result.action === 'abort') {
    console.error(`::error::Daily preview aborted: ${result.reason}`);
    process.exitCode = 1;
  }
}

async function writeManifest(flags) {
  const candidateSha = required(flags, 'candidate');
  if (!isFullSha(candidateSha)) throw new Error('--candidate must be a SHA');
  const bundleSize = JSON.parse(
    await readFile(required(flags, 'bundle-size'), 'utf8'),
  );
  const manifest = {
    schema: 1,
    candidateSha,
    lastGoodSha: required(flags, 'last-good'),
    range: required(flags, 'range'),
    target: required(flags, 'triple'),
    artifactName: required(flags, 'artifact-name'),
    runUrl: required(flags, 'run-url'),
    retentionDays: Number(required(flags, 'retention-days')),
    updater: 'disabled',
    bundleSize,
  };
  await writeFile(
    path.join(required(flags, 'dir'), MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function writeSums(flags) {
  const dir = required(flags, 'dir');
  const hashes = await hashDirectory(dir);
  const lines = Object.keys(hashes)
    .sort()
    .map((name) => `${hashes[name]}  ${name}`);
  await writeFile(path.join(dir, SUMS_FILE), `${lines.join('\n')}\n`);
}

async function verifyArtifact(flags) {
  const dir = required(flags, 'dir');
  const candidateSha = required(flags, 'candidate');
  const problems = [];

  let sums = '';
  try {
    sums = await readFile(path.join(dir, SUMS_FILE), 'utf8');
  } catch {
    problems.push(`missing ${SUMS_FILE}`);
  }
  if (sums !== '') {
    const result = checkChecksums(sums, await hashDirectory(dir));
    problems.push(...result.problems);
  }

  try {
    const manifest = JSON.parse(
      await readFile(path.join(dir, MANIFEST_FILE), 'utf8'),
    );
    if (manifest.candidateSha !== candidateSha) {
      problems.push('manifest commit does not match the planned candidate');
    }
    if (manifest.updater !== 'disabled') {
      problems.push('manifest does not record the updater as disabled');
    }
  } catch {
    problems.push(`missing or unreadable ${MANIFEST_FILE}`);
  }

  const dmgs = (await readdir(dir)).filter((name) => name.endsWith('.dmg'));
  if (dmgs.length !== 1) {
    problems.push(`expected exactly one .dmg, found ${dmgs.length}`);
  } else if ((await stat(path.join(dir, dmgs[0]))).size === 0) {
    problems.push(`${dmgs[0]} is empty`);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`artifact verified: ${dmgs[0]}`);
  await emitOutputs({ dmg: dmgs[0] });
}

async function computeNextPointer(flags) {
  const expected = required(flags, 'expected');
  const pointer = nextPointer({
    current: await readPointerFlag(required(flags, 'current')),
    expectedPrevious: expected === 'none' ? null : expected,
    candidateSha: required(flags, 'candidate'),
    verified: required(flags, 'verified') === 'true',
    now: flags.now ?? new Date().toISOString(),
    runUrl: required(flags, 'run-url'),
    artifact: required(flags, 'artifact'),
  });
  await writeFile(
    required(flags, 'out'),
    `${JSON.stringify(pointer, null, 2)}\n`,
  );
}

const COMMANDS = {
  plan,
  'write-manifest': writeManifest,
  'write-sums': writeSums,
  'verify-artifact': verifyArtifact,
  'next-pointer': computeNextPointer,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(
      `usage: daily-preview.mjs <${Object.keys(COMMANDS).join('|')}>`,
    );
    process.exit(2);
  }
  try {
    await handler(parseFlags(rest));
  } catch (error) {
    console.error(`::error::${command} failed: ${error.message}`);
    process.exit(1);
  }
}
