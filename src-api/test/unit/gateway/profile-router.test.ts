import { describe, expect, it } from 'vitest';

import type {
  InboundMessage,
  RoutingRule,
} from '@/shared/services/gateway/channels/types';
import {
  classifyIntent,
  globMatches,
  pickRoutingRule,
} from '@/shared/services/gateway/core/profile-router';

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channelId: 'slack',
    chatId: 'T01:C123',
    senderId: 'U123',
    senderName: 'Ada',
    content: 'please fix this TypeScript test',
    contentType: 'text',
    timestamp: new Date(0).toISOString(),
    raw: {},
    ...overrides,
  };
}

function rule(overrides: Partial<RoutingRule> = {}): RoutingRule {
  return {
    id: crypto.randomUUID(),
    workspace_id: '*',
    channel_id: '*',
    chat_pattern: '*',
    intent: '*',
    profile_id: 'default-profile',
    model_override: null,
    priority: 100,
    enabled: 1,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('profile-router pure matching', () => {
  it('classifies common gateway intents without an LLM dependency', () => {
    expect(classifyIntent('please fix this failing test')).toBe('code');
    expect(classifyIntent('research sources and cite them')).toBe('research');
    expect(classifyIntent('triage the incident queue')).toBe('triage');
    expect(classifyIntent('hello')).toBe('*');
  });

  it('matches glob chat patterns', () => {
    expect(globMatches('T01:C*', 'T01:C123')).toBe(true);
    expect(
      globMatches('discord:guild/*/general', 'discord:guild/1/general'),
    ).toBe(true);
    expect(globMatches('T02:*', 'T01:C123')).toBe(false);
  });

  it('picks the most specific enabled rule by priority then freshness', () => {
    const selected = pickRoutingRule(
      [
        rule({ profile_id: 'disabled', priority: 1000, enabled: 0 }),
        rule({ profile_id: 'fallback', priority: 10 }),
        rule({
          profile_id: 'older',
          channel_id: 'slack',
          chat_pattern: 'T01:*',
          intent: 'code',
          priority: 500,
          updated_at: '2026-04-24T00:00:00.000Z',
        }),
        rule({
          profile_id: 'newer',
          channel_id: 'slack',
          chat_pattern: 'T01:*',
          intent: 'code',
          priority: 500,
          updated_at: '2026-04-25T00:00:00.000Z',
        }),
      ],
      message(),
      'code',
      'T01',
    );

    expect(selected?.profile_id).toBe('newer');
  });
});
