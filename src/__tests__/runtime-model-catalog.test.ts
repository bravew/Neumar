import { describe, expect, it } from 'vitest';

import {
  CLAUDE_MODELS,
  type ModelOption,
} from '@/components/shared/ChatInput.types';
import {
  buildModeModelOptions,
  buildRuntimeModelOptions,
  isRuntimeRunnable,
  resolveProviderModeSupport,
} from '@/components/shared/runtime-model-catalog';
import { resolveSelectableVideoModel } from '@/components/video/useVideoAgentModel';
import { MODEL_PRICING } from '@/config/pricing';
import type { AIProvider } from '@/shared/db/settings';
import { buildModelOverride } from '@/shared/hooks/agent-utils';
import { CONTEXT_WINDOWS } from '@/shared/hooks/useContextUsage';
import type { AgentRuntimeStatus } from '@/shared/lib/api/agent-runtimes';
import {
  formatRuntimeModelId,
  parseRuntimeModelId,
} from '@/shared/lib/runtime-model-ids';

function runtimeFixture(
  overrides: Partial<AgentRuntimeStatus> = {},
): AgentRuntimeStatus {
  return {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor-agent',
    available: true,
    auth: { state: 'authenticated' },
    models: [
      { id: 'default', label: 'default' },
      { id: 'auto', label: 'auto' },
    ],
    streamFormat: 'json-event-stream',
    eventParser: 'cursor-agent',
    capabilities: {
      execution: true,
      structuredStream: true,
      acp: false,
      rpc: false,
      modes: {
        task: 'supported',
        design: 'supported',
        video: 'supported',
      },
    },
    ...overrides,
  };
}

const claudeProvider: AIProvider = {
  id: 'claude',
  name: 'Claude',
  apiKey: '',
  baseUrl: '',
  enabled: true,
  models: [],
  billingType: 'subscription',
  agentType: 'claude',
};

describe('runtime model ids', () => {
  it('keeps every curated Claude row priced and context-aware', () => {
    for (const model of CLAUDE_MODELS) {
      expect(
        Object.keys(MODEL_PRICING).some((key) => model.id.includes(key)),
        `missing pricing for ${model.id}`,
      ).toBe(true);
      expect(
        Object.keys(CONTEXT_WINDOWS).some((key) => model.id.includes(key)),
        `missing context window for ${model.id}`,
      ).toBe(true);
    }
    expect(
      CLAUDE_MODELS.filter(
        (model) => model.descKey === 'modelDescMostCapable',
      ).map((model) => model.id),
    ).toEqual(['claude-opus-5']);
  });

  it('round-trips structured runtime model ids', () => {
    const id = formatRuntimeModelId('cursor-agent', 'auto');
    expect(id).toBe('cursor-agent:auto');
    expect(parseRuntimeModelId(id)).toEqual({
      runtimeId: 'cursor-agent',
      model: 'auto',
    });
  });

  it('does not parse codex ids — they keep the existing contract', () => {
    expect(parseRuntimeModelId('codex:gpt-5.5')).toBeNull();
    expect(parseRuntimeModelId('claude-sonnet-5')).toBeNull();
  });

  it('uses server mode capabilities before the provider fallback', () => {
    const serverUnsupported = runtimeFixture({
      id: 'openai-compat',
      capabilities: {
        execution: true,
        structuredStream: true,
        acp: false,
        rpc: false,
        modes: {
          task: 'unsupported',
          design: 'supported',
          video: 'unsupported',
        },
      },
    });
    expect(
      resolveProviderModeSupport('openai-compat', 'task', [serverUnsupported]),
    ).toBe('unsupported');
    expect(resolveProviderModeSupport('openai-compat', 'task', [])).toBe(
      'supported',
    );
    expect(resolveProviderModeSupport('openai-compat', 'video', [])).toBe(
      'unsupported',
    );
  });
});

describe('runtime model catalog', () => {
  it('offers models only for runnable runtimes', () => {
    expect(isRuntimeRunnable(runtimeFixture())).toBe(true);
    expect(isRuntimeRunnable(runtimeFixture({ available: false }))).toBe(false);
    expect(
      isRuntimeRunnable(runtimeFixture({ auth: { state: 'unauthenticated' } })),
    ).toBe(false);
    // Unknown auth (no probe) stays runnable; run errors surface auth issues
    expect(isRuntimeRunnable(runtimeFixture({ auth: undefined }))).toBe(true);
  });

  it('builds structured options scoped to the selected runtime', () => {
    const options = buildRuntimeModelOptions([runtimeFixture()], 'task');
    expect(options.map((o) => o.id)).toEqual([
      'cursor-agent:default',
      'cursor-agent:auto',
    ]);
    expect(options[0]).toMatchObject({
      provider: 'cursor-agent',
      description: 'Cursor Agent',
    });
  });

  it('shows video-incapable runtimes as disabled rows in the video catalog', () => {
    const qwen = runtimeFixture({
      id: 'qwen',
      name: 'Qwen Code',
      bin: 'qwen',
      models: [{ id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' }],
      capabilities: {
        execution: true,
        structuredStream: false,
        acp: false,
        rpc: false,
        modes: { task: 'supported', design: 'supported', video: 'unsupported' },
      },
    });
    const options = buildRuntimeModelOptions([qwen], 'video');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.disabled).toBe(true);
      expect(option.disabledReason).toContain('Not available in this mode');
    }
    // Cursor Agent is bridge-proven for video — enabled when runnable.
    const cursorVideo = buildRuntimeModelOptions([runtimeFixture()], 'video');
    expect(cursorVideo.length).toBeGreaterThan(0);
    expect(cursorVideo.every((o) => !o.disabled)).toBe(true);
  });

  it('runs Kimi and AtomCode in Task while keeping both blocked in Video', () => {
    const experimentalRuntimes = [
      runtimeFixture({
        id: 'kimi',
        name: 'Kimi CLI',
        models: [{ id: 'kimi-default', label: 'Kimi Default' }],
        capabilities: {
          execution: true,
          structuredStream: true,
          acp: true,
          rpc: false,
          modes: {
            task: 'experimental',
            design: 'experimental',
            video: 'unsupported',
          },
        },
      }),
      runtimeFixture({
        id: 'atomcode',
        name: 'AtomCode',
        models: [{ id: 'default', label: 'Default' }],
        capabilities: {
          execution: true,
          structuredStream: false,
          acp: false,
          rpc: false,
          modes: {
            task: 'experimental',
            design: 'experimental',
            video: 'unsupported',
          },
        },
      }),
    ];

    expect(
      buildRuntimeModelOptions(experimentalRuntimes, 'task').every(
        (option) => !option.disabled,
      ),
    ).toBe(true);
    expect(
      buildRuntimeModelOptions(experimentalRuntimes, 'video').every(
        (option) => option.disabled,
      ),
    ).toBe(true);
  });

  it('shows unauthenticated runtimes as disabled rows with a sign-in reason', () => {
    const unauth = runtimeFixture({ auth: { state: 'unauthenticated' } });
    const options = buildRuntimeModelOptions([unauth], 'task');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.disabled).toBe(true);
      expect(option.disabledReason).toContain('Sign-in required');
    }
  });

  it('keeps an unavailable discovered model visible with its reason', () => {
    const runtime = runtimeFixture({
      models: [
        {
          id: 'retired-model',
          label: 'Retired Model',
          availability: 'unavailable',
          unavailableReason: 'Removed by the runtime',
        },
      ],
    });

    expect(buildRuntimeModelOptions([runtime], 'task')).toEqual([
      expect.objectContaining({
        label: 'Retired Model',
        disabled: true,
        disabledReason: 'Removed by the runtime',
      }),
    ]);
  });

  it('omits not-installed runtimes entirely', () => {
    const missing = runtimeFixture({ available: false });
    expect(buildRuntimeModelOptions([missing], 'task')).toEqual([]);
  });

  it('merges provider-backed and runtime-backed options per mode', () => {
    const claudeRuntime = runtimeFixture({
      id: 'claude',
      name: 'Claude Code',
      bin: 'claude',
    });
    const options = buildModeModelOptions(
      {},
      [claudeProvider],
      [runtimeFixture(), claudeRuntime],
      'task',
    );
    const providers = new Set(options.map((o) => o.provider));
    expect(providers.has('claude')).toBe(true);
    expect(providers.has('cursor-agent')).toBe(true);
    expect(
      options
        .filter((o) => o.provider === 'cursor-agent')
        .every((o) => !o.disabled),
    ).toBe(true);

    const videoOptions = buildModeModelOptions(
      {},
      [claudeProvider],
      [runtimeFixture(), claudeRuntime],
      'video',
    );
    const videoCursor = videoOptions.filter(
      (o) => o.provider === 'cursor-agent',
    );
    expect(videoCursor.length).toBeGreaterThan(0);
    expect(videoCursor.every((o) => !o.disabled)).toBe(true);
    expect(
      videoOptions.some((o) => o.provider === 'claude' && !o.disabled),
    ).toBe(true);
  });

  it('prefers the live backend catalog over curated provider fallbacks', () => {
    const claudeRuntime = runtimeFixture({
      id: 'claude',
      name: 'Claude Code',
      bin: 'claude',
      models: [
        {
          id: 'claude-future-live',
          label: 'Claude Future Live',
          source: 'discovered',
          availability: 'available',
          contextWindowTokens: 2_000_000,
        },
      ],
    });
    const options = buildModeModelOptions(
      {},
      [claudeProvider],
      [claudeRuntime],
      'task',
    );

    expect(options.filter((option) => option.provider === 'claude')).toEqual([
      expect.objectContaining({
        id: 'claude-future-live',
        source: 'discovered',
        contextWindowTokens: 2_000_000,
      }),
    ]);
  });

  it('keeps curated provider rows when the runtime only reports its fallback list', () => {
    const claudeRuntime = runtimeFixture({
      id: 'claude',
      name: 'Claude Code',
      bin: 'claude',
      models: [
        { id: 'sonnet', label: 'Sonnet (alias)', source: 'fallback' },
        { id: 'claude-sonnet-5', label: 'claude-sonnet-5', source: 'fallback' },
      ],
    });
    const options = buildModeModelOptions(
      {},
      [claudeProvider],
      [claudeRuntime],
      'task',
    );

    const claudeIds = options
      .filter((option) => option.provider === 'claude')
      .map((option) => option.id);
    expect(claudeIds).not.toContain('sonnet');
    expect(claudeIds).toContain('claude-opus-5');
    expect(claudeIds).toContain('claude-sonnet-5');
  });
});

describe('buildModelOverride runtime routing', () => {
  it('converts structured runtime ids to agentType + bare model', () => {
    expect(buildModelOverride('cursor-agent:auto')).toEqual({
      model: 'auto',
      agentType: 'cursor-agent',
    });
    expect(buildModelOverride('qwen:qwen3-coder-plus')).toEqual({
      model: 'qwen3-coder-plus',
      agentType: 'qwen',
    });
    expect(buildModelOverride('copilot:claude-sonnet-5')).toEqual({
      model: 'claude-sonnet-5',
      agentType: 'copilot',
    });
  });

  it('preserves the codex contract: prefixed model plus codex agentType', () => {
    expect(buildModelOverride('codex:gpt-5.5')).toEqual({
      model: 'codex:gpt-5.5',
      agentType: 'codex',
    });
  });

  it('treats a bare "default" id as no override instead of a literal model name', () => {
    // Regression: a stale/legacy `lastSelectedChatModel` of bare "default"
    // (missing its `cursor-agent:` runtime prefix) used to fall through to
    // `{ model: 'default' }` with no agentType, which the backend defaulted
    // to the Claude provider — passing "default" straight to the Claude
    // Agent SDK, which rejects it as an unknown model.
    expect(buildModelOverride('default')).toEqual({});
  });
});

describe('video runtime model selection', () => {
  const videoOptions = [
    {
      id: 'claude-sonnet-5',
      label: 'Sonnet 5',
      description: 'Claude',
      provider: 'claude',
    },
    {
      id: 'qwen:qwen3-coder-plus',
      label: 'qwen3-coder-plus',
      description: 'Qwen Code',
      provider: 'qwen',
      disabled: true,
      disabledReason: 'Not available in this mode yet',
    },
    {
      id: 'cursor-agent:auto',
      label: 'auto',
      description: 'Cursor Agent',
      provider: 'cursor-agent',
    },
  ] satisfies ModelOption[];

  it('falls back when a persisted runtime model is not video-capable', () => {
    expect(
      resolveSelectableVideoModel('qwen:qwen3-coder-plus', videoOptions),
    ).toBe('claude-sonnet-5');
    expect(
      resolveSelectableVideoModel('copilot:claude-sonnet-5', videoOptions),
    ).toBe('claude-sonnet-5');
  });

  it('preserves bridge-proven runtime selections', () => {
    expect(resolveSelectableVideoModel('cursor-agent:auto', videoOptions)).toBe(
      'cursor-agent:auto',
    );
  });

  it('repairs a runtime id when no server capability evidence is loaded', () => {
    expect(resolveSelectableVideoModel('cursor-agent:auto', [])).toBe(
      'claude-sonnet-5',
    );
  });
});
