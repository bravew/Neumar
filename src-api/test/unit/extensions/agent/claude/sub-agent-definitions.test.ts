/**
 * `buildSubAgentDefinitions` — agent-profile → SDK `AgentDefinition` mapping
 * (issue #76 / C6). Every profile-backed sub-agent carries its own complete
 * persona and must not inherit the user's project CLAUDE.md
 * (`omitClaudeMd: true`, SDK 0.3.271).
 */
import { describe, expect, it } from 'vitest';

import { buildSubAgentDefinitions } from '@/extensions/agent/claude';

import type { AgentProfile } from '@/shared/db/types';

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-1',
    name: 'support-bot',
    role: 'Support agent',
    description: 'Handles customer support questions',
    avatar_color: null,
    avatar_icon: null,
    runtime_id: 'claude',
    default_model: 'claude-sonnet-5',
    default_provider: null,
    default_mcp_servers: null,
    default_skills: null,
    system_prompt: 'You are Support Bot, a helpful customer support agent.',
    soul: null,
    soul_version: 1,
    soul_origin: 'user',
    corrections_log: null,
    learnings: null,
    max_concurrent_tasks: 1,
    max_delegation_depth: 1,
    allowed_delegates: null,
    session_compaction_policy: 'default',
    max_session_messages: 200,
    default_thinking_config: null,
    routing_hints: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildSubAgentDefinitions', () => {
  it('sets omitClaudeMd on every agent-profile sub-agent', () => {
    const defs = buildSubAgentDefinitions([makeProfile()]);
    expect(defs['support-bot']?.omitClaudeMd).toBe(true);
  });

  it('carries the profile system prompt and description through', () => {
    const defs = buildSubAgentDefinitions([makeProfile()]);
    expect(defs['support-bot']).toMatchObject({
      description: 'Handles customer support questions',
      prompt: 'You are Support Bot, a helpful customer support agent.',
      omitClaudeMd: true,
    });
  });

  it('falls back to a role-based prompt/description when unset', () => {
    const defs = buildSubAgentDefinitions([
      makeProfile({
        name: 'fallback-bot',
        description: null,
        system_prompt: null,
      }),
    ]);
    expect(defs['fallback-bot']).toMatchObject({
      description: 'Support agent',
      prompt: 'You are fallback-bot, a Support agent',
      omitClaudeMd: true,
    });
  });

  it('excludes the current session profile from its own sub-agent list', () => {
    const defs = buildSubAgentDefinitions(
      [makeProfile({ id: 'profile-1', name: 'self' })],
      'profile-1',
    );
    expect(defs).toEqual({});
  });

  it('excludes inactive profiles', () => {
    const defs = buildSubAgentDefinitions([
      makeProfile({ name: 'archived-bot', status: 'archived' }),
    ]);
    expect(defs).toEqual({});
  });

  it('maps every remaining active, non-self profile with omitClaudeMd true', () => {
    const defs = buildSubAgentDefinitions(
      [
        makeProfile({ id: 'p1', name: 'agent-one' }),
        makeProfile({ id: 'p2', name: 'agent-two' }),
        makeProfile({ id: 'p3', name: 'self', status: 'active' }),
      ],
      'p3',
    );
    expect(Object.keys(defs).sort()).toEqual(['agent-one', 'agent-two']);
    for (const def of Object.values(defs)) {
      expect(def.omitClaudeMd).toBe(true);
    }
  });
});
