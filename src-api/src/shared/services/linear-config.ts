/**
 * Linear Config Manager
 *
 * Manages Linear integration configuration with encrypted secret storage.
 * Secrets are encrypted at rest using AES-256-GCM with per-field unique IVs.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import { dirname } from 'path';

import { z } from 'zod';

import {
  DEFAULT_POLL_INTERVAL_MS,
  getLinearConfigPath,
} from '@/config/constants';

import type { LinearAuthMode } from '@/shared/services/linear-auth';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('LinearConfig');

// ============================================================================
// Types
// ============================================================================

/**
 * Agent capability flags — restrictive by default.
 * Controls what pipeline actions the agent is allowed to perform.
 */
export interface AgentCapabilities {
  canCreateBranches: boolean;
  canCreatePRs: boolean;
  /** Merge PRs automatically — almost always false. Requires explicit opt-in. */
  canMerge: boolean;
  /** Deploy after merge — almost always false. */
  canDeploy: boolean;
  canCreateSubIssues: boolean;
  canModifyLabels: boolean;
  canCloseIssues: boolean;
  /** Max concurrent pipelines. Default: 3 */
  maxConcurrentPipelines: number;
}

export const defaultAgentCapabilities: AgentCapabilities = {
  canCreateBranches: true,
  canCreatePRs: true,
  canMerge: false,
  canDeploy: false,
  canCreateSubIssues: true,
  canModifyLabels: true,
  canCloseIssues: false,
  maxConcurrentPipelines: 3,
};

/** Zod schema for runtime validation of repo mappings from config file */
const RepoMappingSchema = z.object({
  name: z.string().min(1),
  teamId: z.string().optional(),
  labelPattern: z.string().optional(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  baseBranch: z.string().optional(),
  priority: z.number().int().optional().default(0),
});

export type RepoMapping = z.infer<typeof RepoMappingSchema>;

export const RepoMappingsSchema = z.array(RepoMappingSchema);

export interface LinearConfig {
  linearEnabled: boolean;
  slackEnabled: boolean;
  figmaEnabled: boolean;
  teamId: string;
  assigneeFilter: string;
  autoProcess: boolean;
  workspaceDir: string;
  defaultBranch: string;
  pollIntervalMs: number;
  pollEnabled: boolean;
  webhookEnabled: boolean;
  slackChannel: string;
  apiKey: string;
  webhookSecret: string;
  githubToken: string;
  slackWebhookUrl: string;
  figmaToken: string;
  repoMappings: RepoMapping[];
  authMode: LinearAuthMode;
  clientId: string;
  clientSecret: string;
  /** Agent's Linear user ID — used for self-assign and assignee filtering */
  agentUserId: string;
  /** Agent display name shown in Linear comments */
  agentName: string;
  /** Labels that trigger the pipeline (e.g. "agent-ready") — checked alongside assigneeFilter */
  triggerLabels: string[];
  /** Agent capability restrictions */
  capabilities: AgentCapabilities;
  /** Max USD budget per single ticket pipeline run. Default: 10 */
  maxUsdPerTicket: number;
  /** Max USD budget across all pipeline runs per day. Default: 100 */
  maxUsdPerDay: number;
  /** Issue categories that always require human approval regardless of confidence score */
  requireApprovalFor: string[];
  /** Linear user display names authorized to approve/reject the confidence gate.
   *  Empty array = any commenter can approve (open gate). */
  approvalAuthorizedNames: string[];
}

interface EncryptedField {
  iv: string;
  data: string;
  tag: string;
}

interface DiskConfig {
  linearEnabled?: boolean;
  slackEnabled?: boolean;
  figmaEnabled?: boolean;
  teamId?: string;
  assigneeFilter?: string;
  autoProcess?: boolean;
  workspaceDir?: string;
  defaultBranch?: string;
  pollIntervalMs?: number;
  pollEnabled?: boolean;
  webhookEnabled?: boolean;
  slackChannel?: string;
  apiKey?: EncryptedField | string;
  webhookSecret?: EncryptedField | string;
  githubToken?: EncryptedField | string;
  slackWebhookUrl?: EncryptedField | string;
  figmaToken?: EncryptedField | string;
  repoMappings?:
    | RepoMapping[]
    | Record<string, { owner: string; repo: string; baseBranch?: string }>;
  authMode?: LinearAuthMode;
  clientId?: string;
  clientSecret?: EncryptedField | string;
  agentUserId?: string;
  agentName?: string;
  triggerLabels?: string[];
  capabilities?: Partial<AgentCapabilities>;
  maxUsdPerTicket?: number;
  maxUsdPerDay?: number;
  requireApprovalFor?: string[];
  approvalAuthorizedNames?: string[];
  _salt?: string;
  _nonce?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SENSITIVE_FIELDS = [
  'apiKey',
  'webhookSecret',
  'githubToken',
  'slackWebhookUrl',
  'figmaToken',
  'clientSecret',
] as const;

export const defaultLinearConfig: LinearConfig = {
  linearEnabled: false,
  slackEnabled: false,
  figmaEnabled: false,
  teamId: '',
  assigneeFilter: '',
  autoProcess: false,
  workspaceDir: '',
  defaultBranch: 'main',
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  pollEnabled: false,
  webhookEnabled: true,
  slackChannel: '',
  apiKey: '',
  webhookSecret: '',
  githubToken: '',
  slackWebhookUrl: '',
  figmaToken: '',
  repoMappings: [],
  authMode: 'personal_api_key',
  clientId: '',
  clientSecret: '',
  agentUserId: '',
  agentName: '',
  triggerLabels: [],
  capabilities: { ...defaultAgentCapabilities },
  maxUsdPerTicket: 10,
  maxUsdPerDay: 100,
  requireApprovalFor: [],
  approvalAuthorizedNames: [],
};

// ============================================================================
// Module-level state
// ============================================================================

let configCache: LinearConfig | null = null;

// ============================================================================
// Encryption helpers
// ============================================================================

function encryptField(value: string, key: Buffer): EncryptedField {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptField(encrypted: EncryptedField, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encrypted.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    typeof value === 'object' &&
    value !== null &&
    'iv' in value &&
    'data' in value &&
    'tag' in value
  );
}

async function deriveKey(salt: Buffer, nonce: string): Promise<Buffer> {
  const seed = `${os.hostname()}${os.userInfo().username}${nonce}`;
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(seed, salt, 100000, 32, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

async function getEncryptionKey(
  diskConfig: DiskConfig,
): Promise<{ key: Buffer; salt: string; nonce: string }> {
  let salt: Buffer;
  let nonce: string;

  if (diskConfig._salt && diskConfig._nonce) {
    salt = Buffer.from(diskConfig._salt, 'base64');
    nonce = diskConfig._nonce;
  } else {
    salt = crypto.randomBytes(32);
    nonce = crypto.randomBytes(16).toString('base64');
  }

  const key = await deriveKey(salt, nonce);
  return { key, salt: salt.toString('base64'), nonce };
}

// ============================================================================
// Public API
// ============================================================================

/** Load config from disk, decrypt secrets, return defaults for missing fields */
export async function loadLinearConfig(): Promise<LinearConfig> {
  const configPath = getLinearConfigPath();

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const diskConfig: DiskConfig = JSON.parse(content);
    const { key } = await getEncryptionKey(diskConfig);

    const config: LinearConfig = { ...defaultLinearConfig };

    // Load plaintext fields
    if (diskConfig.linearEnabled !== undefined)
      config.linearEnabled = diskConfig.linearEnabled;
    if (diskConfig.slackEnabled !== undefined)
      config.slackEnabled = diskConfig.slackEnabled;
    if (diskConfig.figmaEnabled !== undefined)
      config.figmaEnabled = diskConfig.figmaEnabled;
    if (diskConfig.teamId !== undefined) config.teamId = diskConfig.teamId;
    if (diskConfig.assigneeFilter !== undefined)
      config.assigneeFilter = diskConfig.assigneeFilter;
    if (diskConfig.autoProcess !== undefined)
      config.autoProcess = diskConfig.autoProcess;
    if (diskConfig.workspaceDir !== undefined)
      config.workspaceDir = diskConfig.workspaceDir;
    if (diskConfig.defaultBranch !== undefined)
      config.defaultBranch = diskConfig.defaultBranch;
    if (diskConfig.pollIntervalMs !== undefined)
      config.pollIntervalMs = diskConfig.pollIntervalMs;
    if (diskConfig.pollEnabled !== undefined)
      config.pollEnabled = diskConfig.pollEnabled;
    if (diskConfig.webhookEnabled !== undefined)
      config.webhookEnabled = diskConfig.webhookEnabled;
    if (diskConfig.slackChannel !== undefined)
      config.slackChannel = diskConfig.slackChannel;
    if (diskConfig.authMode !== undefined)
      config.authMode = diskConfig.authMode;
    if (diskConfig.clientId !== undefined)
      config.clientId = diskConfig.clientId;
    if (diskConfig.agentUserId !== undefined)
      config.agentUserId = diskConfig.agentUserId;
    if (diskConfig.agentName !== undefined)
      config.agentName = diskConfig.agentName;
    if (diskConfig.triggerLabels !== undefined)
      config.triggerLabels = diskConfig.triggerLabels;
    if (diskConfig.capabilities !== undefined)
      config.capabilities = {
        ...defaultAgentCapabilities,
        ...diskConfig.capabilities,
      };
    if (diskConfig.maxUsdPerTicket !== undefined)
      config.maxUsdPerTicket = diskConfig.maxUsdPerTicket;
    if (diskConfig.maxUsdPerDay !== undefined)
      config.maxUsdPerDay = diskConfig.maxUsdPerDay;
    if (diskConfig.requireApprovalFor !== undefined)
      config.requireApprovalFor = diskConfig.requireApprovalFor;
    if (diskConfig.approvalAuthorizedNames !== undefined)
      config.approvalAuthorizedNames = diskConfig.approvalAuthorizedNames;
    if (diskConfig.repoMappings !== undefined) {
      if (Array.isArray(diskConfig.repoMappings)) {
        const parsed = RepoMappingsSchema.safeParse(diskConfig.repoMappings);
        config.repoMappings = parsed.success ? parsed.data : [];
        if (!parsed.success) {
          logger.warn(
            'Invalid repoMappings entries ignored:',
            parsed.error.issues,
          );
        }
      } else {
        // Migrate legacy Record<teamId, repo> format to RepoMapping[]
        config.repoMappings = Object.entries(diskConfig.repoMappings).map(
          ([teamId, mapping]) => ({
            name: `Team ${teamId}`,
            teamId,
            owner: mapping.owner,
            repo: mapping.repo,
            baseBranch: mapping.baseBranch,
            priority: 0,
          }),
        );
        logger.info(
          `Migrated ${config.repoMappings.length} repoMappings from legacy Record format`,
        );
      }
    }

    // Decrypt sensitive fields
    for (const field of SENSITIVE_FIELDS) {
      const value = diskConfig[field];
      if (isEncryptedField(value)) {
        try {
          config[field] = decryptField(value, key);
        } catch (err) {
          logger.warn(`Failed to decrypt ${field}, using default`, err);
          config[field] = '';
        }
      } else if (typeof value === 'string') {
        // Migration: plaintext value from older config
        config[field] = value;
      }
    }

    configCache = config;
    logger.info('Config loaded successfully');
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info('No config file found, using defaults');
    } else {
      logger.error('Failed to load config', err);
    }
    configCache = { ...defaultLinearConfig };
    return configCache;
  }
}

/** Merge partial updates, encrypt secrets, write to disk */
export async function saveLinearConfig(
  updates: Partial<LinearConfig>,
): Promise<void> {
  const configPath = getLinearConfigPath();

  // Load existing disk config for salt/nonce preservation
  let diskConfig: DiskConfig = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    diskConfig = JSON.parse(content);
  } catch {
    // No existing config
  }

  // Merge with current cache
  const current = configCache ?? { ...defaultLinearConfig };
  const merged: LinearConfig = { ...current, ...updates };
  configCache = merged;

  // Get encryption key
  const { key, salt, nonce } = await getEncryptionKey(diskConfig);

  // Build disk representation
  const toDisk: DiskConfig = {
    linearEnabled: merged.linearEnabled,
    slackEnabled: merged.slackEnabled,
    figmaEnabled: merged.figmaEnabled,
    teamId: merged.teamId,
    assigneeFilter: merged.assigneeFilter,
    autoProcess: merged.autoProcess,
    workspaceDir: merged.workspaceDir,
    defaultBranch: merged.defaultBranch,
    pollIntervalMs: merged.pollIntervalMs,
    pollEnabled: merged.pollEnabled,
    webhookEnabled: merged.webhookEnabled,
    slackChannel: merged.slackChannel,
    repoMappings: merged.repoMappings,
    authMode: merged.authMode,
    clientId: merged.clientId,
    agentUserId: merged.agentUserId,
    agentName: merged.agentName,
    triggerLabels: merged.triggerLabels,
    capabilities: merged.capabilities,
    maxUsdPerTicket: merged.maxUsdPerTicket,
    maxUsdPerDay: merged.maxUsdPerDay,
    requireApprovalFor: merged.requireApprovalFor,
    approvalAuthorizedNames: merged.approvalAuthorizedNames,
    _salt: salt,
    _nonce: nonce,
  };

  // Encrypt sensitive fields
  for (const field of SENSITIVE_FIELDS) {
    const value = merged[field];
    if (value) {
      toDisk[field] = encryptField(value, key);
    } else {
      toDisk[field] = '';
    }
  }

  // Write to disk
  await fs.mkdir(dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(toDisk, null, 2), 'utf-8');

  // Set file permissions (owner read/write only) on Unix/macOS
  if (os.platform() !== 'win32') {
    await fs.chmod(configPath, 0o600);
  }

  logger.info('Config saved successfully');
}

/** Sync getter from cache (call loadLinearConfig on startup first) */
export function getLinearConfig(): LinearConfig {
  if (!configCache) {
    logger.warn('Config not loaded yet, returning defaults');
    return { ...defaultLinearConfig };
  }
  return configCache;
}
