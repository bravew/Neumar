#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const localeRoot = path.join(root, 'src/config/locale/messages');
const locales = ['en', 'zh', 'es', 'fr', 'hi', 'pt'];
const target = process.argv[2] ?? 'video.ts';

function loadObject(filePath) {
  const source = fs
    .readFileSync(filePath, 'utf8')
    .replace(/^export default\s+/, 'module.exports = ');
  const context = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(source, context, { filename: filePath });
  return context.module.exports;
}

function paths(value, prefix = '') {
  if (!value || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

const baseline = loadObject(path.join(localeRoot, 'en', target));
const baselinePaths = new Set(paths(baseline));
const failures = [];

for (const locale of locales.filter((item) => item !== 'en')) {
  const filePath = path.join(localeRoot, locale, target);
  const currentPaths = new Set(paths(loadObject(filePath)));
  const missing = [...baselinePaths].filter((key) => !currentPaths.has(key));
  if (missing.length) {
    failures.push(`${locale}/${target}: missing ${missing.join(', ')}`);
  }
}

if (failures.length) {
  console.error(`Locale parity check failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Locale parity check passed for ${target}`);
