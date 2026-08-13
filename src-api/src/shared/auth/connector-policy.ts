/**
 * Connector access policy — Phase A of the Connector Token Isolation plan
 * (`dev-doc/plan/2026-04-28-connector-tier-isolation.md`).
 *
 * Single source of truth for "is this caller allowed to mount the global
 * admin connector token?". Fail-closed: any error, unknown platform, or
 * missing context evaluates to deny-all globally-scoped connectors.
 *
 * Globally-scoped connectors (resolved via `getValidAccessToken(provider)`
 * with no identity argument) must NOT be mounted for non-admin Slack /
 * Discord / etc. callers. Identity-scoped connectors (Slack App Home
 * `slack_user_oauth`) keep working as before.
 */

import { getAuditLog } from '@/shared/channels/audit-log';
import type { ConnectorToolApproval } from '@/shared/connectors/catalog';
import { getConnectorDefinition } from '@/shared/connectors/seed';
import { getDatabase } from '@/shared/db';
import { getSetting } from '@/shared/db/operations';
import type { PermissionTier } from '@/shared/services/gateway/channels/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ConnectorPolicy');

export type GlobalConnector = string;

export const LEGACY_GLOBAL_CONNECTORS = [
  'google',
  'notion',
  'slack_user_token',
  'schedule_create',
  'publish',
] as const;

type LegacyGlobalConnector = (typeof LEGACY_GLOBAL_CONNECTORS)[number];

export interface ConnectorPolicyInput {
  /** Channel platform: 'desktop' for the local UI, otherwise the adapter id */
  platform?: string;
  permissionTier?: PermissionTier;
  identityId?: string;
  /** True when invoked from a scheduled automation run */
  automationOrigin?: boolean;
  /**
   * Stable channel identifier (Phase B per-channel override key). For Slack
   * this is the workspace config id; falls back to platform when absent.
   */
  channelId?: string;
}

/**
 * Phase B — Settings → Connectors per-channel access setting shape.
 * Stored under key `connectors.<provider>.access` as JSON.
 */
export interface ConnectorAccessSetting {
  /** Tier that may use this connector when no per-channel override matches */
  defaultTier: PermissionTier | 'disabled';
  /** Per-channel override map keyed by channelId */
  channels?: Record<string, PermissionTier | 'disabled'>;
}

const PROVIDER_ACCESS_KEYS: Record<LegacyGlobalConnector, string> = {
  google: 'connectors.google.access',
  notion: 'connectors.notion.access',
  slack_user_token: 'connectors.slack_user_token.access',
  schedule_create: 'connectors.schedule_create.access',
  publish: 'connectors.publish.access',
};

export function connectorAccessSettingKey(connector: GlobalConnector): string {
  return (
    PROVIDER_ACCESS_KEYS[connector as LegacyGlobalConnector] ??
    `connectors.${connector}.access`
  );
}

const TIER_RANK: Record<PermissionTier, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

function readAccessSetting(
  connector: GlobalConnector,
): ConnectorAccessSetting | null {
  try {
    const raw = getSetting(connectorAccessSettingKey(connector));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConnectorAccessSetting;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    // Fail closed — caller defaults to admin-only when this returns null.
    return null;
  }
}

function tierMeets(
  caller: PermissionTier | undefined,
  required: PermissionTier | 'disabled',
): boolean {
  if (required === 'disabled') return false;
  if (!caller) return false;
  return TIER_RANK[caller] >= TIER_RANK[required];
}

/**
 * Resolve the per-connector required tier for a (platform, channelId) pair.
 * Returns 'admin' (the safe default) when no setting exists.
 */
function requiredTierFor(
  connector: GlobalConnector,
  channelId: string | undefined,
): PermissionTier | 'disabled' {
  const setting = readAccessSetting(connector);
  if (!setting) return 'admin';
  if (channelId && setting.channels && setting.channels[channelId]) {
    return setting.channels[channelId];
  }
  return setting.defaultTier ?? 'admin';
}

export interface ConnectorPolicy {
  allowGoogle: boolean;
  allowNotion: boolean;
  allowSlackUserToken: boolean;
  /** Whether this caller may create new schedules / automations */
  allowScheduleCreate: boolean;
  /** Whether this caller may create or manage publish jobs */
  allowPublish: boolean;
}

const ALLOW_FIELD: Record<LegacyGlobalConnector, keyof ConnectorPolicy> = {
  google: 'allowGoogle',
  notion: 'allowNotion',
  slack_user_token: 'allowSlackUserToken',
  schedule_create: 'allowScheduleCreate',
  publish: 'allowPublish',
};

const DENY_ALL: ConnectorPolicy = Object.freeze({
  allowGoogle: false,
  allowNotion: false,
  allowSlackUserToken: false,
  allowScheduleCreate: false,
  allowPublish: false,
});

const ALLOW_ALL: ConnectorPolicy = Object.freeze({
  allowGoogle: true,
  allowNotion: true,
  allowSlackUserToken: true,
  allowScheduleCreate: true,
  allowPublish: true,
});

const KNOWN_PLATFORMS = new Set([
  'desktop',
  'slack',
  'discord',
  'telegram',
  'lark',
  'feishu',
  'whatsapp',
  'sms',
  'imessage',
  'linear',
]);

export interface ConnectorRunContext extends ConnectorPolicyInput {
  runId?: string;
  surface?: 'desktop' | 'channel' | 'automation' | 'design_mode' | 'subprocess';
  configId?: string;
  conversationId?: string;
  accountId?: string;
}

export interface ConnectorExecutionDecision {
  allow: boolean;
  requireConfirmation: boolean;
  approval: ConnectorToolApproval;
  policyKey: string;
  reason?: string;
}

export interface ConnectorToolOverride {
  accountId: string;
  connectorId: string;
  toolName: string;
  approval: ConnectorToolApproval;
  updatedAt: number;
}

export function policyKeyForConnectorContext(
  context: ConnectorRunContext | undefined,
): string {
  if (!context) return 'unknown';
  if (context.surface === 'desktop' || context.platform === 'desktop') {
    return 'desktop';
  }
  if (context.automationOrigin || context.surface === 'automation') {
    return `automation:${context.accountId ?? context.identityId ?? 'unknown'}`;
  }
  if (context.platform && context.configId) {
    return `${context.platform}:${context.configId}`;
  }
  if (context.channelId) return context.channelId;
  return context.platform ?? 'unknown';
}

export function getConnectorToolOverride(
  accountId: string,
  connectorId: string,
  toolName: string,
): ConnectorToolOverride | null {
  try {
    const row = getDatabase()
      .prepare(
        `SELECT account_id, connector_id, tool_name, approval, updated_at
         FROM connector_tool_overrides
         WHERE account_id = ? AND connector_id = ? AND tool_name = ?`,
      )
      .get(accountId, connectorId, toolName) as
      | {
          account_id: string;
          connector_id: string;
          tool_name: string;
          approval: ConnectorToolApproval;
          updated_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      accountId: row.account_id,
      connectorId: row.connector_id,
      toolName: row.tool_name,
      approval: row.approval,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function setConnectorToolOverride(input: {
  accountId: string;
  connectorId: string;
  toolName: string;
  approval: ConnectorToolApproval;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO connector_tool_overrides
         (account_id, connector_id, tool_name, approval, updated_at)
       VALUES (?, ?, ?, ?, unixepoch())
       ON CONFLICT(account_id, connector_id, tool_name)
       DO UPDATE SET approval = excluded.approval, updated_at = unixepoch()`,
    )
    .run(input.accountId, input.connectorId, input.toolName, input.approval);
}

export function readConnectorToolOverrides(
  accountId: string,
  connectorId: string,
): ConnectorToolOverride[] {
  try {
    const rows = getDatabase()
      .prepare(
        `SELECT account_id, connector_id, tool_name, approval, updated_at
         FROM connector_tool_overrides
         WHERE account_id = ? AND connector_id = ?
         ORDER BY tool_name ASC`,
      )
      .all(accountId, connectorId) as Array<{
      account_id: string;
      connector_id: string;
      tool_name: string;
      approval: ConnectorToolApproval;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      accountId: row.account_id,
      connectorId: row.connector_id,
      toolName: row.tool_name,
      approval: row.approval,
      updatedAt: row.updated_at,
    }));
  } catch {
    return [];
  }
}

export function canExecuteConnectorTool(input: {
  context: ConnectorRunContext | undefined;
  connectorId: string;
  toolName: string;
  /**
   * Optional live tool definition resolved from the runtime catalog (e.g.
   * tools discovered from Composio at hydration time). When provided, the
   * policy uses it as a fallback so dynamically discovered tools are not
   * rejected just because the static seed doesn't enumerate them.
   */
  tool?: {
    safety: {
      approval: ConnectorToolApproval;
      sideEffect?: string;
    };
  };
}): ConnectorExecutionDecision {
  const policyKey = policyKeyForConnectorContext(input.context);
  const accountId = input.context?.accountId ?? 'default';
  const definition = getConnectorDefinition(input.connectorId);
  const seedTool = definition?.tools.find(
    (entry) => entry.name === input.toolName,
  );
  const tool = seedTool ?? input.tool;

  if (!tool) {
    return {
      allow: false,
      requireConfirmation: false,
      approval: 'disabled',
      policyKey,
      reason: 'connector-tool-not-found',
    };
  }

  const required = requiredTierFor(input.connectorId, policyKey);
  if (!tierMeets(input.context?.permissionTier, required)) {
    return {
      allow: false,
      requireConfirmation: false,
      approval: tool.safety.approval,
      policyKey,
      reason: 'tier-denied',
    };
  }

  const override = getConnectorToolOverride(
    accountId,
    input.connectorId,
    input.toolName,
  );
  const approval = applyToolApprovalOverride(
    tool.safety.approval,
    override?.approval,
  );

  if (approval === 'disabled') {
    return {
      allow: false,
      requireConfirmation: false,
      approval,
      policyKey,
      reason: 'tool-disabled',
    };
  }

  if (
    input.context?.surface === 'channel' &&
    input.context.platform !== 'desktop' &&
    (approval !== 'auto' || tool.safety.sideEffect !== 'read')
  ) {
    return {
      allow: false,
      requireConfirmation: false,
      approval,
      policyKey,
      reason: 'channel-requires-desktop-approval',
    };
  }

  return {
    allow: true,
    requireConfirmation: approval === 'confirm',
    approval,
    policyKey,
  };
}

function applyToolApprovalOverride(
  base: ConnectorToolApproval,
  override: ConnectorToolApproval | undefined,
): ConnectorToolApproval {
  if (!override) return base;
  if (base === 'disabled' && override === 'auto') return 'disabled';
  return override;
}

/**
 * Resolve the connector policy for a caller. Fail-closed for any path that
 * isn't explicitly allowed.
 */
export function resolveConnectorPolicy(
  input: ConnectorPolicyInput | undefined,
): ConnectorPolicy {
  try {
    if (!input) return DENY_ALL;

    const { platform, permissionTier, automationOrigin, channelId } = input;

    // Desktop UI is the install-owner; trust it.
    if (platform === 'desktop') return ALLOW_ALL;

    // Automation runs must carry a creator tier — when missing, fail closed.
    // When present, treat them as that creator.
    if (automationOrigin && permissionTier === 'admin') {
      return ALLOW_ALL;
    }

    if (!platform || !KNOWN_PLATFORMS.has(platform)) {
      // Unknown platform → fail closed.
      return DENY_ALL;
    }

    const channelKey = channelId ?? platform;
    return {
      allowGoogle: tierMeets(
        permissionTier,
        requiredTierFor('google', channelKey),
      ),
      allowNotion: tierMeets(
        permissionTier,
        requiredTierFor('notion', channelKey),
      ),
      allowSlackUserToken: tierMeets(
        permissionTier,
        requiredTierFor('slack_user_token', channelKey),
      ),
      allowScheduleCreate: tierMeets(
        permissionTier,
        requiredTierFor('schedule_create', channelKey),
      ),
      allowPublish: tierMeets(
        permissionTier,
        requiredTierFor('publish', channelKey),
      ),
    };
  } catch (err) {
    logger.warn('resolveConnectorPolicy failed; defaulting to deny-all', err);
    return DENY_ALL;
  }
}

/**
 * Single canonical refusal copy per connector, localised. Returned for the
 * agent to emit as a plain text turn (no tool_use frame) when policy denies.
 */
export function getConnectorDenialMessage(
  connector: GlobalConnector,
  locale?: string,
): string {
  const lang = (locale ?? 'en').slice(0, 2).toLowerCase();
  const table = DENIAL_COPY[lang] ?? DENIAL_COPY.en;
  if (!table) return GENERIC_DENIAL_FALLBACK;
  return table[connector] ?? table.generic;
}

type DenialTable = Partial<Record<GlobalConnector, string>> & {
  generic: string;
};

const GENERIC_DENIAL_FALLBACK =
  "This connector isn't available for your tier on this channel. Ask an admin to enable it in Settings → Connectors.";

const DENIAL_COPY: Record<string, DenialTable> = {
  en: {
    google:
      "Google Workspace isn't available for your tier on this channel. Ask an admin to enable it in Settings → Connectors.",
    notion:
      "Notion isn't available for your tier on this channel. Ask an admin to enable it in Settings → Connectors.",
    slack_user_token:
      "The shared Slack user token isn't available for your tier on this channel. Ask an admin to enable it in Settings → Connectors.",
    schedule_create:
      'Only admins can create new automations. Ask an admin to schedule this for you.',
    publish:
      "Publishing isn't available for your tier on this channel. Ask an admin to enable it in Settings → Connectors.",
    generic:
      "This connector isn't available for your tier on this channel. Ask an admin to enable it in Settings → Connectors.",
  },
  zh: {
    google:
      '你当前的权限层级在此频道无法使用 Google Workspace。请让管理员在「设置 → 连接器」中启用。',
    notion:
      '你当前的权限层级在此频道无法使用 Notion。请让管理员在「设置 → 连接器」中启用。',
    slack_user_token:
      '你当前的权限层级在此频道无法使用共享的 Slack 用户令牌。请让管理员在「设置 → 连接器」中启用。',
    schedule_create: '只有管理员可以创建新的自动化任务。请让管理员代为安排。',
    publish:
      '你当前的权限层级在此频道无法使用发布功能。请让管理员在「设置 → 连接器」中启用。',
    generic:
      '你当前的权限层级在此频道无法使用此连接器。请让管理员在「设置 → 连接器」中启用。',
  },
  es: {
    google:
      'Google Workspace no está disponible para tu nivel en este canal. Pide a un administrador que lo habilite en Ajustes → Conectores.',
    notion:
      'Notion no está disponible para tu nivel en este canal. Pide a un administrador que lo habilite en Ajustes → Conectores.',
    slack_user_token:
      'El token compartido de Slack no está disponible para tu nivel en este canal. Pide a un administrador que lo habilite en Ajustes → Conectores.',
    schedule_create:
      'Solo los administradores pueden crear nuevas automatizaciones. Pide a un administrador que la programe.',
    publish:
      'La publicación no está disponible para tu nivel en este canal. Pide a un administrador que la habilite en Ajustes → Conectores.',
    generic:
      'Este conector no está disponible para tu nivel en este canal. Pide a un administrador que lo habilite en Ajustes → Conectores.',
  },
  fr: {
    google:
      "Google Workspace n'est pas disponible pour votre niveau sur ce canal. Demandez à un administrateur de l'activer dans Paramètres → Connecteurs.",
    notion:
      "Notion n'est pas disponible pour votre niveau sur ce canal. Demandez à un administrateur de l'activer dans Paramètres → Connecteurs.",
    slack_user_token:
      "Le jeton Slack partagé n'est pas disponible pour votre niveau sur ce canal. Demandez à un administrateur de l'activer dans Paramètres → Connecteurs.",
    schedule_create:
      'Seuls les administrateurs peuvent créer de nouvelles automatisations. Demandez à un administrateur de la planifier.',
    publish:
      "La publication n'est pas disponible pour votre niveau sur ce canal. Demandez à un administrateur de l'activer dans Paramètres → Connecteurs.",
    generic:
      "Ce connecteur n'est pas disponible pour votre niveau sur ce canal. Demandez à un administrateur de l'activer dans Paramètres → Connecteurs.",
  },
  hi: {
    google:
      'इस चैनल पर आपके स्तर के लिए Google Workspace उपलब्ध नहीं है। किसी एडमिन से सेटिंग्स → कनेक्टर्स में इसे सक्षम करने को कहें।',
    notion:
      'इस चैनल पर आपके स्तर के लिए Notion उपलब्ध नहीं है। किसी एडमिन से सेटिंग्स → कनेक्टर्स में इसे सक्षम करने को कहें।',
    slack_user_token:
      'इस चैनल पर आपके स्तर के लिए साझा Slack टोकन उपलब्ध नहीं है। किसी एडमिन से सेटिंग्स → कनेक्टर्स में इसे सक्षम करने को कहें।',
    schedule_create:
      'केवल एडमिन ही नई ऑटोमेशन बना सकते हैं। किसी एडमिन से इसे शेड्यूल करने को कहें।',
    publish:
      'इस चैनल पर आपके स्तर के लिए प्रकाशन उपलब्ध नहीं है। किसी एडमिन से सेटिंग्स → कनेक्टर्स में इसे सक्षम करने को कहें।',
    generic:
      'इस चैनल पर आपके स्तर के लिए यह कनेक्टर उपलब्ध नहीं है। किसी एडमिन से सेटिंग्स → कनेक्टर्स में इसे सक्षम करने को कहें।',
  },
  pt: {
    google:
      'O Google Workspace não está disponível para o seu nível neste canal. Peça a um administrador para habilitá-lo em Configurações → Conectores.',
    notion:
      'O Notion não está disponível para o seu nível neste canal. Peça a um administrador para habilitá-lo em Configurações → Conectores.',
    slack_user_token:
      'O token compartilhado do Slack não está disponível para o seu nível neste canal. Peça a um administrador para habilitá-lo em Configurações → Conectores.',
    schedule_create:
      'Apenas administradores podem criar novas automações. Peça a um administrador para agendá-la.',
    publish:
      'A publicação não está disponível para o seu nível neste canal. Peça a um administrador para habilitá-la em Configurações → Conectores.',
    generic:
      'Este conector não está disponível para o seu nível neste canal. Peça a um administrador para habilitá-lo em Configurações → Conectores.',
  },
};

/** Audit-log a gating decision. Best-effort; never throws. */
export function logConnectorGateDecision(args: {
  decision: 'allow' | 'deny';
  connector: GlobalConnector;
  platform?: string;
  tier?: PermissionTier;
  identityId?: string;
  automationOrigin?: boolean;
}): void {
  try {
    void getAuditLog().write(
      'connector_gate',
      args.identityId ?? null,
      args.platform ?? null,
      {
        decision: args.decision,
        connector: args.connector,
        tier: args.tier ?? null,
        automation_origin: !!args.automationOrigin,
      },
    );
  } catch {
    // best-effort
  }
  if (args.decision === 'deny') {
    logger.info(
      `connector denied: connector=${args.connector} tier=${args.tier ?? 'unknown'} platform=${args.platform ?? 'unknown'} automation=${!!args.automationOrigin}`,
    );
  }
}

/**
 * Evaluate a single connector against the policy and audit-log the
 * decision. Returns a denial-hint string suitable for system-prompt folding
 * when access is blocked. Single source of truth used by every adapter
 * (Claude in-process, Codex via subprocess bridge, …).
 */
export function evaluateConnectorGate(
  connector: GlobalConnector,
  channelContext: (ConnectorPolicyInput & { configId?: string }) | undefined,
  locale?: string,
): { allow: boolean; denialHint?: string } {
  const policy = resolveConnectorPolicy(
    channelContext
      ? {
          ...channelContext,
          channelId:
            channelContext.channelId ?? channelContext.configId ?? undefined,
        }
      : undefined,
  );
  const legacyField = ALLOW_FIELD[connector as LegacyGlobalConnector];
  const allow = legacyField
    ? policy[legacyField]
    : canExecuteConnectorTool({
        connectorId: connector,
        toolName: '',
        context: channelContext,
      }).allow;
  logConnectorGateDecision({
    decision: allow ? 'allow' : 'deny',
    connector,
    platform: channelContext?.platform,
    tier: channelContext?.permissionTier,
    identityId: channelContext?.identityId,
    automationOrigin: channelContext?.automationOrigin,
  });
  if (allow) return { allow: true };
  // Hint stays minimal — public refusal copy only, no internal tier/platform
  // metadata that a jailbreak could surface via the system prompt.
  const refusal = getConnectorDenialMessage(connector, locale);
  return {
    allow: false,
    denialHint: `[connector-policy] If the user asks to use ${connector}, reply verbatim with: "${refusal}"`,
  };
}

export type PublishConnectorScope =
  | 'publish'
  | 'publish:human'
  | `publish:${string}`
  | `publish:session:${string}`;

export interface PublishPolicyInput extends ConnectorPolicyInput {
  /** Explicit human token marker for desktop/UI-only approval calls. */
  human?: boolean;
  locale?: string;
  /** Extra explicit scopes minted by channel-specific OAuth or admin policy. */
  publishScopes?: string[];
  configId?: string;
}

export function canUsePublishScope(
  input: PublishPolicyInput | undefined,
  scope: PublishConnectorScope,
): boolean {
  if (!input) return false;
  if (scope === 'publish:human') {
    return input.human === true || input.platform === 'desktop';
  }
  if (input.platform === 'desktop') return true;
  if (input.permissionTier === 'admin') return true;

  const scopes = new Set(input.publishScopes ?? []);
  const destinationScope = destinationScopeFor(scope);
  if (scope === 'publish' && scopes.size > 0) return true;
  if (scopes.has(scope) || (destinationScope && scopes.has(destinationScope))) {
    return true;
  }

  const base = resolveConnectorPolicy({
    ...input,
    channelId: input.channelId ?? input.configId ?? undefined,
  }).allowPublish;
  if (!base) return false;
  if (scope === 'publish') return true;
  return false;
}

export function evaluatePublishConnectorGate(
  scope: PublishConnectorScope,
  input: PublishPolicyInput | undefined,
  locale?: string,
): { allow: boolean; denialHint?: string } {
  const allow = canUsePublishScope(input, scope);
  logConnectorGateDecision({
    decision: allow ? 'allow' : 'deny',
    connector: 'publish',
    platform: input?.platform,
    tier: input?.permissionTier,
    identityId: input?.identityId,
    automationOrigin: input?.automationOrigin,
  });
  if (allow) return { allow: true };
  const refusal = getConnectorDenialMessage('publish', locale);
  return {
    allow: false,
    denialHint: `[connector-policy] If the user asks to publish content, reply verbatim with: "${refusal}"`,
  };
}

function destinationScopeFor(scope: PublishConnectorScope): string | null {
  if (scope === 'publish' || scope === 'publish:human') return null;
  if (scope.startsWith('publish:session:')) {
    return `publish:${scope.slice('publish:session:'.length)}`;
  }
  return scope;
}
