#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const localeDir = path.join(root, 'src/config/locale/messages');
const sourceDirs = [
  path.join(root, 'src/components/design/critique'),
  path.join(root, 'src/components/design/ProjectHeader.tsx'),
];
const locales = ['en', 'zh', 'es', 'fr', 'hi', 'pt'];
const keys = [
  'designJury',
  'designJuryScore',
  'designJuryTranscript',
  'designJuryWatchReplay',
  'designJuryTheaterLabel',
  'designJuryRound',
  'designJuryRoundSummary',
  'designJuryMustFix',
  'designJuryWarnings',
  'designJuryShipped',
  'designJuryDegraded',
  'designJuryInterrupted',
  'designJuryFailed',
  'designJuryRoles',
];
const roleKeys = ['designer', 'critic', 'brand', 'accessibility', 'copy'];

const failures = [];
const sourceCorpus = readSourceCorpus(sourceDirs);

for (const key of keys) {
  if (!sourceCorpus.includes(`design.${key}`)) {
    failures.push(`stale critique i18n key is not referenced: ${key}`);
  }
}

for (const locale of locales) {
  const file = path.join(localeDir, locale, 'design.ts');
  const content = fs.readFileSync(file, 'utf8');
  for (const key of keys) {
    if (!new RegExp(`\\b${key}\\s*:`).test(content)) {
      failures.push(`${locale}/design.ts is missing ${key}`);
    }
  }
  const rolesBlock = content.match(
    /designJuryRoles:\s*\{(?<body>[\s\S]*?)\n\s*\}/,
  )?.groups?.body;
  if (!rolesBlock) {
    failures.push(`${locale}/design.ts is missing designJuryRoles block`);
    continue;
  }
  for (const role of roleKeys) {
    if (!new RegExp(`\\b${role}\\s*:`).test(rolesBlock)) {
      failures.push(`${locale}/design.ts is missing designJuryRoles.${role}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

function readSourceCorpus(entries) {
  let corpus = '';
  for (const entry of entries) {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(entry)) {
        corpus += readSourceCorpus([path.join(entry, child)]);
      }
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) corpus += fs.readFileSync(entry, 'utf8');
  }
  return corpus;
}
