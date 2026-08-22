import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'src-video', 'package.json');
const skillPath = path.join(
  root,
  'plugins',
  'builtin',
  'design-skills',
  'hyperframes',
  'skills',
  'hyperframes',
  'SKILL.md',
);

function packagePin(raw) {
  const parsed = JSON.parse(raw);
  const pin = parsed.devDependencies?.hyperframes;
  if (typeof pin !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin)) {
    throw new Error('src-video/package.json must exactly pin hyperframes.');
  }
  return pin;
}

function skillPin(raw) {
  const match = /^upstream-version:\s*(\d+\.\d+\.\d+)\s*$/m.exec(raw);
  if (!match) {
    throw new Error('Bundled HyperFrames SKILL.md has no upstream-version.');
  }
  return match[1];
}

function assertPinsMatch(packageVersion, skillVersion) {
  if (packageVersion !== skillVersion) {
    throw new Error(
      `Bundled HyperFrames skill records ${skillVersion}, but src-video pins ${packageVersion}.`,
    );
  }
}

if (process.argv.includes('--self-test')) {
  try {
    assertPinsMatch('0.8.7', '0.8.6');
  } catch (error) {
    if (error instanceof Error && error.message.includes('0.8.6')) {
      console.log('HyperFrames drift guard mismatch self-test passed.');
      process.exit(0);
    }
    throw error;
  }
  throw new Error('HyperFrames drift guard accepted a mismatched pin.');
}

const packageVersion = packagePin(fs.readFileSync(packagePath, 'utf8'));
const skillVersion = skillPin(fs.readFileSync(skillPath, 'utf8'));
assertPinsMatch(packageVersion, skillVersion);
console.log(`HyperFrames bundled skill matches pinned CLI ${packageVersion}.`);
