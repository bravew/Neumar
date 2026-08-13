/**
 * DB-backed profile routing for inbound channel messages.
 *
 * Matching is deterministic: explicit routing_rules first, then profile
 * routing_hints, then configured channel defaults.
 */

import { getAllAgentProfiles, getChannelConfig } from '@/shared/db/operations';
import type { AgentProfile, ChannelPlatform } from '@/shared/db/types';

import type {
  GatewayIntent,
  InboundMessage,
  RoutingRule,
} from '../channels/types';
import type { GatewayConfig } from '../shared/config/types';
import * as gatewayDb from '../shared/db/operations';

const INTENT_PATTERNS: Array<[Exclude<GatewayIntent, '*'>, RegExp]> = [
  ['code', /\b(code|bug|fix|diff|pr|repo|test|typescript|rust)\b/i],
  ['research', /\b(research|search|investigate|source|cite|internet)\b/i],
  ['planning', /\b(plan|roadmap|milestone|estimate|break down)\b/i],
  ['triage', /\b(triage|prioritize|queue|inbox|incident|alert)\b/i],
  ['support', /\b(help|support|customer|issue|ticket|how do i)\b/i],
];

export interface ProfileRoute {
  profileId?: string;
  modelOverride?: string;
  intent: GatewayIntent;
  reason: 'rule' | 'profile_hint' | 'channel_default' | 'gateway_default';
}

interface RoutingHints {
  channels?: string[];
  intents?: string[];
  chatPatterns?: string[];
}

export function classifyIntent(content: string): GatewayIntent {
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(content)) return intent;
  }
  return '*';
}

export function resolveWorkspaceId(message: InboundMessage): string {
  const raw = `${message.channelId}:${message.chatId}`;
  if (message.channelId === 'slack') return message.chatId.split(':')[0] || '*';
  if (message.channelId === 'discord') {
    const [guild] = message.chatId.split('/');
    return guild || '*';
  }
  return raw.split(':')[0] || '*';
}

export function globMatches(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
  return regex.test(value);
}

export function pickRoutingRule(
  rules: RoutingRule[],
  message: InboundMessage,
  intent: GatewayIntent,
  workspaceId = resolveWorkspaceId(message),
): RoutingRule | null {
  const candidates = rules
    .filter((rule) => rule.enabled === 1)
    .filter(
      (rule) => rule.workspace_id === '*' || rule.workspace_id === workspaceId,
    )
    .filter(
      (rule) =>
        rule.channel_id === '*' || rule.channel_id === message.channelId,
    )
    .filter((rule) => rule.intent === '*' || rule.intent === intent)
    .filter((rule) => globMatches(rule.chat_pattern, message.chatId))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.updated_at.localeCompare(a.updated_at);
    });
  return candidates[0] ?? null;
}

export class ProfileRouter {
  constructor(private config: GatewayConfig) {}

  route(message: InboundMessage): ProfileRoute {
    const intent = classifyIntent(message.content);
    const rule = pickRoutingRule(
      gatewayDb.getEnabledRoutingRules(),
      message,
      intent,
    );
    if (rule) {
      return {
        profileId: rule.profile_id,
        modelOverride: rule.model_override ?? undefined,
        intent,
        reason: 'rule',
      };
    }

    const hinted = this.matchProfileHints(message, intent);
    if (hinted) {
      return { profileId: hinted.id, intent, reason: 'profile_hint' };
    }

    const dbChannelConf = getChannelConfig(
      message.channelId as ChannelPlatform,
    );
    if (dbChannelConf?.agent_profile_id) {
      return {
        profileId: dbChannelConf.agent_profile_id,
        modelOverride: dbChannelConf.model ?? undefined,
        intent,
        reason: 'channel_default',
      };
    }

    const gatewayConf = this.config.channels[
      message.channelId as keyof typeof this.config.channels
    ] as { agentProfileId?: string | null } | undefined;
    return {
      profileId: gatewayConf?.agentProfileId ?? undefined,
      intent,
      reason: 'gateway_default',
    };
  }

  private matchProfileHints(
    message: InboundMessage,
    intent: GatewayIntent,
  ): AgentProfile | null {
    for (const profile of getAllAgentProfiles('active')) {
      const hints = parseHints(profile.routing_hints);
      if (!hints) continue;
      if (
        hints.channels?.length &&
        !hints.channels.includes('*') &&
        !hints.channels.includes(message.channelId)
      ) {
        continue;
      }
      if (
        hints.intents?.length &&
        !hints.intents.includes('*') &&
        !hints.intents.includes(intent)
      ) {
        continue;
      }
      if (
        hints.chatPatterns?.length &&
        !hints.chatPatterns.some((pattern) =>
          globMatches(pattern, message.chatId),
        )
      ) {
        continue;
      }
      return profile;
    }
    return null;
  }
}

function parseHints(raw: string | null): RoutingHints | null {
  if (!raw || raw === '{}') return null;
  try {
    const parsed = JSON.parse(raw) as RoutingHints;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
