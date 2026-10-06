import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeAgent } from '@/extensions/agent/claude';

const { query, directApiStream } = vi.hoisted(() => ({
  query:
    vi.fn<(args: Parameters<typeof sdkQuery>[0]) => AsyncIterable<unknown>>(),
  directApiStream: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk/core', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@anthropic-ai/claude-agent-sdk/core')
  >()),
  query,
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: directApiStream };
  },
}));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execSync: vi.fn(() => '/mock/bin/claude'),
  execFileSync: vi.fn(() => '2.1.289 (Claude Code)'),
}));
vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: vi.fn((path) => path === '/mock/bin/claude'),
  readdirSync: vi.fn(() => []),
}));
vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs/promises')>()),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(() => undefined),
  getAllAgentProfiles: vi.fn(() => []),
}));
vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getLogFilePath: () => '/mock/logs/app.log',
  getLogDirectory: () => '/mock/logs',
  LOG_FILE_PATH: '/mock/logs/app.log',
  LOG_DIR_PATH: '/mock/logs',
  redactValue: (value: unknown) => value,
}));
vi.mock('@/shared/auth/oauth-client', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
  getGrantedScopes: vi.fn().mockResolvedValue([]),
}));

const MODEL = 'claude/claude-sonnet-5-5';
const ANSWER =
  'The gateway-backed planner can answer this request without executing any tools.';

async function collectPlan(agent: ClaudeAgent) {
  const messages = [];
  for await (const message of agent.plan('Explain the project architecture', {
    cwd: '/mock/sessions/planning',
    skillsConfig: {
      enabled: false,
      userDirEnabled: false,
      appDirEnabled: false,
    },
    resolvedContext: {
      full: '',
      minimal: '',
      staticContext: '',
      dynamicContext: '',
      profileAllowedSkills: [],
    },
  })) {
    messages.push(message);
  }
  return messages;
}

describe('ClaudeAgent planning settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep the CLI-auth fallback deterministic even inside an authenticated shell.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ANTHROPIC_')) vi.stubEnv(key, undefined);
    }
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', undefined);
    vi.stubEnv('ANTHROPIC_BASE_URL', undefined);

    query.mockImplementation(async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: ANSWER }] },
      };
    });
    directApiStream.mockImplementation(() => {
      throw new Error('Direct API unavailable');
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads user gateway settings for CLI-auth planning while disabling tools and MCP servers', async () => {
    const messages = await collectPlan(
      new ClaudeAgent({ provider: 'claude', model: MODEL }),
    );

    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'direct_answer', content: ANSWER }),
    );
    expect(messages.some((message) => message.type === 'error')).toBe(false);
    expect(directApiStream).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledExactlyOnceWith({
      prompt: expect.stringContaining('Explain the project architecture'),
      options: expect.objectContaining({
        settingSources: ['user'],
        model: MODEL,
        tools: [],
        strictMcpConfig: true,
        mcpServers: {},
        env: expect.objectContaining({ ANTHROPIC_MODEL: MODEL }),
      }),
    });
  });

  it('keeps explicit custom API credentials isolated when direct API planning falls back to the SDK', async () => {
    const messages = await collectPlan(
      new ClaudeAgent({
        provider: 'claude',
        model: MODEL,
        apiKey: 'test-api-key',
        baseUrl: 'https://gateway.example.test',
      }),
    );

    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'direct_answer', content: ANSWER }),
    );
    expect(messages.some((message) => message.type === 'error')).toBe(false);
    expect(directApiStream).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledExactlyOnceWith({
      prompt: expect.any(String),
      options: expect.objectContaining({
        settingSources: [],
        model: MODEL,
        tools: [],
        strictMcpConfig: true,
        mcpServers: {},
        env: expect.objectContaining({
          ANTHROPIC_AUTH_TOKEN: 'test-api-key',
          ANTHROPIC_BASE_URL: 'https://gateway.example.test',
          ANTHROPIC_MODEL: MODEL,
        }),
      }),
    });
  });
});
