#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, '..');
const rootDir = resolve(apiDir, '..');
const strict = process.argv.includes('--strict');

function readBrandSlug() {
  try {
    const raw = readFileSync(join(rootDir, 'branding.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed.slug === 'string' && parsed.slug.trim()
      ? parsed.slug.trim()
      : 'neumar';
  } catch {
    return 'neumar';
  }
}

const appDataDir = `.${readBrandSlug()}`;
const appDir = join(homedir(), appDataDir);
const dbPath = join(appDir, 'database.db');

function readEnvKeys(filePath) {
  if (!existsSync(filePath)) return new Set();
  const keys = new Set();
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

const envFiles = [
  join(rootDir, '.env.local'),
  join(rootDir, '.env'),
  join(apiDir, '.env'),
];

const configuredEnvKeys = new Set(Object.keys(process.env));
for (const file of envFiles) {
  for (const key of readEnvKeys(file)) configuredEnvKeys.add(key);
}

function hasEnvKey(key) {
  return configuredEnvKeys.has(key);
}

function openDatabase() {
  if (!existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function tableExists(db, name) {
  if (!db) return false;
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function safeJson(value) {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isPresent(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

function readChannelRows(db) {
  if (!tableExists(db, 'channel_config')) return [];
  return db
    .prepare('SELECT platform, enabled, mode, token FROM channel_config')
    .all();
}

function readGatewayRows(db) {
  if (!tableExists(db, 'gateway_channels')) return [];
  return db
    .prepare('SELECT id, enabled, status, config FROM gateway_channels')
    .all();
}

function channelCredential(channelRows, platform) {
  const rows = channelRows.filter(
    (row) => row.platform === platform && Number(row.enabled) === 1,
  );
  return {
    present: rows.some((row) => isPresent(row.token)),
    source: rows.length
      ? `channel_config ${platform} row(s): ${rows.length}`
      : `no enabled channel_config ${platform} row`,
  };
}

function gatewayCredential(gatewayRows, id, keys) {
  const row = gatewayRows.find(
    (candidate) => candidate.id === id && Number(candidate.enabled) === 1,
  );
  if (!row) {
    return {
      present: false,
      source: `no enabled gateway_channels ${id} row`,
      missing: keys,
    };
  }
  const config = safeJson(row.config);
  const missing = keys.filter((key) => !isPresent(config[key]));
  return {
    present: missing.length === 0,
    source: `gateway_channels ${id} row`,
    missing,
  };
}

function envTargets(keys) {
  const missing = keys.filter((key) => !hasEnvKey(key));
  return {
    present: missing.length === 0,
    source: keys.length ? keys.join(', ') : 'no target keys required',
    missing,
  };
}

function combineCredentials(...credentials) {
  const present = credentials.some((credential) => credential.present);
  return {
    present,
    source: credentials.map((credential) => credential.source).join('; '),
    missing: credentials.flatMap((credential) => credential.missing ?? []),
  };
}

function statusFor(credentials, targets) {
  if (credentials.present && targets.present) return 'ready';
  if (credentials.present) return 'partial';
  return 'blocked';
}

const db = openDatabase();
const channelRows = readChannelRows(db);
const gatewayRows = readGatewayRows(db);

const checks = [
  {
    provider: 'Slack regression',
    runtimeClass: 'official',
    credentials: channelCredential(channelRows, 'slack'),
    targets: envTargets(['SLACK_SMOKE_CHANNEL_ID', 'SLACK_SMOKE_DM_USER_ID']),
  },
  {
    provider: 'Discord',
    runtimeClass: 'official',
    credentials: combineCredentials(channelCredential(channelRows, 'discord'), {
      present: hasEnvKey('DISCORD_BOT_TOKEN'),
      source: 'DISCORD_BOT_TOKEN',
    }),
    targets: envTargets([
      'DISCORD_DEV_GUILD_ID',
      'DISCORD_SMOKE_CHANNEL_ID',
      'DISCORD_SMOKE_DM_USER_ID',
    ]),
  },
  {
    provider: 'Telegram',
    runtimeClass: 'official',
    credentials: combineCredentials(
      channelCredential(channelRows, 'telegram'),
      {
        present: hasEnvKey('TELEGRAM_BOT_TOKEN'),
        source: 'TELEGRAM_BOT_TOKEN',
      },
    ),
    targets: envTargets([
      'TELEGRAM_SMOKE_DM_CHAT_ID',
      'TELEGRAM_SMOKE_GROUP_CHAT_ID',
      'TELEGRAM_SMOKE_FORUM_TOPIC',
    ]),
  },
  {
    provider: 'Lark / Feishu',
    runtimeClass: 'official',
    credentials: combineCredentials(
      channelCredential(channelRows, 'lark'),
      channelCredential(channelRows, 'feishu'),
      { present: hasEnvKey('LARK_APP_ID'), source: 'LARK_APP_ID' },
      { present: hasEnvKey('FEISHU_APP_ID'), source: 'FEISHU_APP_ID' },
    ),
    targets: envTargets(['LARK_OR_FEISHU_SMOKE_CHAT_ID']),
  },
  {
    provider: 'iMessage / BlueBubbles',
    runtimeClass: 'bridge',
    credentials: gatewayCredential(gatewayRows, 'imessage', [
      'serverUrl',
      'password',
    ]),
    targets: envTargets(['IMESSAGE_SMOKE_TARGET']),
  },
  {
    provider: 'WhatsApp Cloud',
    runtimeClass: 'official',
    credentials: gatewayCredential(gatewayRows, 'whatsapp', [
      'phoneNumberId',
      'accessToken',
      'webhookVerifyToken',
      'appSecret',
    ]),
    targets: envTargets(['WHATSAPP_SMOKE_TO']),
  },
];

console.log(`Channel smoke readiness for ${join('~', appDataDir)}`);
console.log(`Database: ${db ? 'present' : 'missing'} (${dbPath})`);
console.log(
  `Encrypted credential store: ${
    existsSync(join(appDir, 'channel-creds.enc.json')) ? 'present' : 'missing'
  }`,
);
console.log('');

for (const check of checks) {
  const status = statusFor(check.credentials, check.targets);
  console.log(`${status.toUpperCase()} ${check.provider}`);
  console.log(`  runtime: ${check.runtimeClass}`);
  console.log(
    `  credentials: ${check.credentials.present ? 'present' : 'missing'} (${check.credentials.source})`,
  );
  if (check.credentials.missing?.length) {
    console.log(
      `  missing config keys: ${check.credentials.missing.join(', ')}`,
    );
  }
  console.log(
    `  smoke targets: ${check.targets.present ? 'present' : 'missing'} (${check.targets.source})`,
  );
  if (check.targets.missing.length) {
    console.log(`  missing target keys: ${check.targets.missing.join(', ')}`);
  }
  console.log('');
}

if (db) db.close();

if (
  strict &&
  checks.some(
    (check) => statusFor(check.credentials, check.targets) !== 'ready',
  )
) {
  process.exitCode = 1;
}
