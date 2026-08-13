#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const AG_UI_PACKAGES = ['@ag-ui/client', '@ag-ui/core', '@ag-ui/encoder'];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function normalizeVersion(version) {
  return String(version).replace(/^[~^]/, '');
}

function collectDeclaredVersions(label, pkg) {
  const versions = [];
  for (const sectionName of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ]) {
    const section = pkg[sectionName] ?? {};
    for (const packageName of AG_UI_PACKAGES) {
      if (section[packageName]) {
        versions.push({
          label,
          packageName,
          sectionName,
          version: normalizeVersion(section[packageName]),
        });
      }
    }
  }
  return versions;
}

const rootPackage = readJson('package.json');
const apiPackage = readJson('src-api/package.json');
const declared = [
  ...collectDeclaredVersions('root', rootPackage),
  ...collectDeclaredVersions('src-api', apiPackage),
  ...AG_UI_PACKAGES.flatMap((packageName) => {
    const override = rootPackage.pnpm?.overrides?.[packageName];
    return override
      ? [
          {
            label: 'root',
            packageName,
            sectionName: 'pnpm.overrides',
            version: normalizeVersion(override),
          },
        ]
      : [];
  }),
];

const versions = new Set(declared.map((entry) => entry.version));
if (versions.size !== 1) {
  console.error('@ag-ui packages must stay on one lockstep version.');
  for (const entry of declared) {
    console.error(
      `- ${entry.label} ${entry.sectionName} ${entry.packageName}: ${entry.version}`,
    );
  }
  process.exit(1);
}

const packageCoverage = new Map();
for (const entry of declared) {
  const key = `${entry.label}:${entry.packageName}`;
  packageCoverage.set(key, true);
}

for (const label of ['src-api']) {
  for (const packageName of AG_UI_PACKAGES) {
    if (!packageCoverage.has(`${label}:${packageName}`)) {
      console.error(`${label} must declare ${packageName}.`);
      process.exit(1);
    }
  }
}

if (process.env.CHECK_NPM_LATEST === '1') {
  const expected = [...versions][0];
  for (const packageName of AG_UI_PACKAGES) {
    const latest = execFileSync('npm', ['view', packageName, 'version'], {
      encoding: 'utf8',
      timeout: 15_000,
    }).trim();
    if (latest !== expected) {
      console.error(
        `${packageName} latest is ${latest}, but repo declares ${expected}.`,
      );
      process.exit(1);
    }
  }
}

console.log(`AG-UI packages are lockstep at ${[...versions][0]}.`);
