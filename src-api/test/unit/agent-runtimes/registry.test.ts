import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_DEFS,
  deriveRuntimeCapabilities,
  getRuntimeModeSupport,
  canonicalCommandString,
  catalog,
  commandHash,
  describeOptions,
  getAgentDef,
  parseLineSeparatedModels,
  parsePiModels,
  sanitizeCustomModel,
  stripFns,
  clampCodexReasoning,
  isKnownModel,
  rememberLiveModels,
  withModelSource,
  AGENT_PROMPT_TOO_LARGE,
  POSIX_ARGV_PROMPT_LIMIT,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  validatePromptDeliveryBudget,
} from '../../../src/shared/agent-runtimes';

describe('agent-runtimes registry', () => {
  it('exports a non-empty registry with unique ids', () => {
    expect(AGENT_DEFS.length).toBeGreaterThanOrEqual(11);
    const ids = AGENT_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry declares a stream format and at least default model', () => {
    for (const def of AGENT_DEFS) {
      expect(def.streamFormat).toBeDefined();
      expect(def.promptDelivery).toMatch(/^(argv|stdin|file)$/);
      expect(def.fallbackModels.length).toBeGreaterThanOrEqual(1);
      expect(def.fallbackModels[0]?.id).toBe('default');
    }
  });

  it('derives transport capabilities consistently for every runtime', () => {
    for (const def of AGENT_DEFS) {
      const capabilities = deriveRuntimeCapabilities(def, {});
      expect(capabilities.acp).toBe(def.streamFormat === 'acp-json-rpc');
      expect(capabilities.rpc).toBe(def.streamFormat === 'pi-rpc');
      expect(capabilities.execution).toBe(typeof def.buildArgs === 'function');
      expect(capabilities.structuredStream).toBe(
        def.streamFormat !== 'plain' && def.streamFormat !== 'pi-rpc',
      );
    }
  });

  it('treats an absent mode declaration as not evaluated', () => {
    const unevaluated = AGENT_DEFS.find((def) => !def.capabilities?.modes)!;
    const capabilities = deriveRuntimeCapabilities(unevaluated, {});
    expect(capabilities.modes).toBeUndefined();
    expect(getRuntimeModeSupport(capabilities, 'task')).toBeNull();
  });

  it('claude has capability flag probing wired up', () => {
    const claude = getAgentDef('claude');
    expect(claude?.helpArgs).toEqual(['-p', '--help']);
    expect(claude?.capabilityFlags).toMatchObject({
      '--include-partial-messages': 'partialMessages',
      '--add-dir': 'addDir',
    });
  });

  it('stripFns drops closures + probe-only metadata', () => {
    const stripped = stripFns(AGENT_DEFS[0]!);
    expect(stripped).not.toHaveProperty('buildArgs');
    expect(stripped).not.toHaveProperty('listModels');
    expect(stripped).not.toHaveProperty('fetchModels');
    expect(stripped).not.toHaveProperty('fallbackModels');
    expect(stripped).not.toHaveProperty('helpArgs');
    expect(stripped).not.toHaveProperty('capabilityFlags');
    expect(stripped).not.toHaveProperty('authProbe');
    expect(stripped.promptDelivery).toBeDefined();
  });

  it('includes optional upstream runtimes behind binary detection', () => {
    expect(AGENT_DEFS.map((def) => def.id)).toEqual(
      expect.arrayContaining(['devin', 'kilo', 'vibe', 'deepseek']),
    );
    expect(getAgentDef('deepseek')).toMatchObject({
      promptDelivery: 'argv',
      windowsMaxPromptArgBytes: 30_000,
    });
    expect(getAgentDef('deepseek')).not.toHaveProperty('maxPromptArgBytes');
  });

  it('gives OpenCode model discovery enough time for provider startup', () => {
    expect(getAgentDef('opencode')?.listModels).toMatchObject({
      args: ['models'],
      timeoutMs: 15_000,
    });
  });

  it('keeps Cursor trust flags absent until capability probing exists', () => {
    const cursor = getAgentDef('cursor-agent');
    expect(cursor?.capabilityFlags ?? {}).not.toHaveProperty('--trust');
    expect(JSON.stringify(stripFns(cursor!))).not.toContain('--trust');
  });

  it('delivers Copilot prompts through stdin to avoid argv limits', () => {
    expect(getAgentDef('copilot')).toMatchObject({
      promptDelivery: 'stdin',
      promptViaStdin: true,
    });
    expect(getAgentDef('copilot')).not.toHaveProperty('maxPromptArgBytes');
  });

  it('builds Pi RPC args and marks the runtime executable', () => {
    const pi = getAgentDef('pi');
    expect(pi).toMatchObject({
      promptDelivery: 'stdin',
      promptViaStdin: true,
      streamFormat: 'pi-rpc',
    });
    expect(
      pi?.buildArgs?.(
        '',
        [],
        ['/tmp/craft', 'relative'],
        {
          model: 'openai/gpt-5',
          reasoning: 'high',
        },
        {},
      ),
    ).toEqual([
      '--mode',
      'rpc',
      '--model',
      'openai/gpt-5',
      '--thinking',
      'high',
      '--append-system-prompt',
      'You may also access these additional workspace directories outside the current working directory:\n- /tmp/craft',
    ]);
  });

  it('includes expanded Codex model picker coverage', () => {
    expect(
      getAgentDef('codex')?.fallbackModels.map((model) => model.id),
    ).toEqual(
      expect.arrayContaining([
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.1-codex-mini',
      ]),
    );
  });

  it('keeps Qoder hidden unless the experimental feature flag is enabled', async () => {
    expect(getAgentDef('qoder')).toBeNull();

    vi.stubEnv('NEUMA_AGENT_QODER', '1');
    vi.resetModules();
    const flagged = await import('../../../src/shared/agent-runtimes/registry');
    const qoder = flagged.getAgentDef('qoder');

    expect(flagged.isQoderRuntimeEnabled()).toBe(true);
    expect(qoder).toMatchObject({
      id: 'qoder',
      name: 'Qoder CLI (experimental)',
      bin: 'qodercli',
      promptDelivery: 'argv',
      windowsMaxPromptArgBytes: 30_000,
      streamFormat: 'plain',
    });
    expect(qoder).not.toHaveProperty('maxPromptArgBytes');
    expect(qoder?.install?.map((option) => option.id)).toEqual(
      expect.arrayContaining(['npm-latest', 'install-script', 'brew-cask']),
    );
    expect(qoder?.install?.[0]?.args).toEqual([
      'install',
      '-g',
      '@qoder-ai/qodercli',
    ]);

    vi.unstubAllEnvs();
  });

  it('gates Kimi and AtomCode independently with conservative capabilities', async () => {
    expect(getAgentDef('kimi')).toBeNull();
    expect(getAgentDef('atomcode')).toBeNull();

    vi.stubEnv('NEUMA_AGENT_KIMI', '1');
    vi.stubEnv('NEUMA_AGENT_ATOMCODE', '1');
    vi.resetModules();
    const flagged = await import('../../../src/shared/agent-runtimes/registry');
    const kimi = flagged.getAgentDef('kimi');
    const atomcode = flagged.getAgentDef('atomcode');

    expect(kimi).toMatchObject({
      streamFormat: 'acp-json-rpc',
      capabilities: {
        modes: {
          task: 'experimental',
          design: 'experimental',
          video: 'unsupported',
        },
        toolApproval: 'host-mediated',
        mcpInjection: 'native',
      },
    });
    expect(atomcode).toMatchObject({
      promptDelivery: 'file',
      streamFormat: 'plain',
      capabilities: {
        modes: {
          task: 'experimental',
          design: 'experimental',
          video: 'unsupported',
        },
        toolApproval: 'none',
      },
    });
    const args = atomcode?.buildArgs?.(
      'never embed this prompt',
      [],
      [],
      { model: 'claude-sonnet-4-6' },
      { promptFilePath: '/tmp/prompt.txt' },
    );
    expect(args).toContain('--prompt-file');
    expect(args).not.toContain('-y');
    expect(args).not.toContain('--yes');
    expect(args).not.toContain('never embed this prompt');

    vi.unstubAllEnvs();
  });
});

describe('agent prompt delivery guards', () => {
  const argvDef = {
    id: 'argv-agent',
    name: 'Argv Agent',
    promptDelivery: 'argv' as const,
    windowsMaxPromptArgBytes: 10,
  };
  const stdinDef = {
    id: 'stdin-agent',
    name: 'Stdin Agent',
    promptDelivery: 'stdin' as const,
    windowsMaxPromptArgBytes: 1,
  };

  it('uses platform-specific argv prompt budgets and skips stdin adapters', () => {
    expect(checkPromptArgvBudget(argvDef, 'short')).toBe(true);
    expect(
      checkPromptArgvBudget(argvDef, '01234567890', { platform: 'win32' }),
    ).toBe(false);
    expect(
      checkPromptArgvBudget(argvDef, '01234567890', { platform: 'darwin' }),
    ).toBe(true);
    expect(
      checkPromptArgvBudget(argvDef, 'x'.repeat(POSIX_ARGV_PROMPT_LIMIT + 1), {
        platform: 'linux',
      }),
    ).toBe(false);
    expect(checkPromptArgvBudget(stdinDef, '01234567890')).toBe(true);
  });

  it('counts UTF-8 bytes instead of code points', () => {
    expect(checkPromptArgvBudget(argvDef, 'abc😀', { platform: 'win32' })).toBe(
      true,
    );
    expect(
      checkPromptArgvBudget(argvDef, 'abc😀😀', { platform: 'win32' }),
    ).toBe(false);
  });

  it('detects quote-heavy Windows cmd shims over the kernel command-line cap', () => {
    const def = { ...argvDef, windowsMaxPromptArgBytes: 50_000 };
    const prompt = '"'.repeat(20_000);
    expect(checkPromptArgvBudget(def, prompt, { platform: 'win32' })).toBe(
      true,
    );
    expect(
      checkWindowsCmdShimCommandLineBudget(
        def,
        'C:\\tools\\deepseek.cmd',
        ['exec', '--auto', prompt],
        { platform: 'win32' },
      ),
    ).toBe(false);
    expect(
      checkWindowsDirectExeCommandLineBudget(
        def,
        'C:\\tools\\deepseek.cmd',
        ['exec', '--auto', prompt],
        { platform: 'win32' },
      ),
    ).toBe(true);
  });

  it('detects quote-heavy Windows direct exe command lines over the cap', () => {
    const def = { ...argvDef, windowsMaxPromptArgBytes: 50_000 };
    const prompt = '"'.repeat(20_000);
    expect(
      checkWindowsDirectExeCommandLineBudget(
        def,
        'C:\\tools\\deepseek.exe',
        ['exec', '--auto', prompt],
        { platform: 'win32' },
      ),
    ).toBe(false);
    expect(
      checkWindowsCmdShimCommandLineBudget(
        def,
        'C:\\tools\\deepseek.exe',
        ['exec', '--auto', prompt],
        { platform: 'win32' },
      ),
    ).toBe(true);
  });

  it('accounts for cmd percent expansion neutralization', () => {
    const def = { ...argvDef, windowsMaxPromptArgBytes: 50_000 };
    const prompt = '%'.repeat(17_000);
    expect(
      checkWindowsCmdShimCommandLineBudget(
        def,
        'C:\\tools\\deepseek.bat',
        ['exec', prompt],
        { platform: 'win32' },
      ),
    ).toBe(false);
  });

  it('skips Windows command-line guards on POSIX and returns typed failures', () => {
    const def = { ...argvDef, windowsMaxPromptArgBytes: 50_000 };
    const prompt = '"'.repeat(20_000);
    expect(
      checkWindowsDirectExeCommandLineBudget(
        def,
        '/usr/local/bin/deepseek',
        ['exec', prompt],
        { platform: 'darwin' },
      ),
    ).toBe(true);
    const failure = validatePromptDeliveryBudget(
      argvDef,
      '/usr/local/bin/deepseek',
      ['exec', '01234567890'],
      '01234567890',
      { platform: 'win32' },
    );
    expect(failure).toMatchObject({
      ok: false,
      code: AGENT_PROMPT_TOO_LARGE,
    });
  });
});

describe('install option hashing', () => {
  it('canonicalCommandString includes id, command, args', () => {
    const claude = getAgentDef('claude')!;
    const option = claude.install![0]!;
    const s = canonicalCommandString(option);
    expect(JSON.parse(s)).toEqual({
      id: option.id,
      command: option.command,
      args: option.args,
    });
  });

  it('commandHash is deterministic', () => {
    const claude = getAgentDef('claude')!;
    const option = claude.install![0]!;
    expect(commandHash(option)).toBe(commandHash(option));
    expect(commandHash(option)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('describeOptions returns rendered + commandHash for current platform', () => {
    const opts = describeOptions('claude', 'install');
    expect(opts).not.toBeNull();
    expect(opts!.length).toBeGreaterThan(0);
    for (const o of opts!) {
      expect(o.commandHash).toMatch(/^[a-f0-9]{64}$/);
      expect(o.rendered).toContain(o.command);
    }
  });

  it('catalog spans every agent', () => {
    const c = catalog();
    const ids = c.map((e) => e.id);
    expect(new Set(ids)).toEqual(new Set(AGENT_DEFS.map((d) => d.id)));
  });
});

describe('model parsers', () => {
  it('preserves optional model metadata through serialization', () => {
    const models = withModelSource(
      [
        {
          id: 'claude-opus-5',
          label: 'Claude Opus 5',
          contextWindowTokens: 1_000_000,
          capabilityTags: ['chat', 'vision', 'reasoning', 'code'],
          costTier: 'high',
          speedTier: 'low',
          compatibleReasoningTiers: ['low', 'medium', 'high', 'xhigh', 'max'],
          compatibleServiceTiers: ['auto', 'standard_only'],
        },
      ],
      'discovered',
    );

    expect(JSON.parse(JSON.stringify(models))).toEqual([
      {
        id: 'claude-opus-5',
        label: 'Claude Opus 5',
        source: 'discovered',
        availability: 'unknown',
        contextWindowTokens: 1_000_000,
        capabilityTags: ['chat', 'vision', 'reasoning', 'code'],
        costTier: 'high',
        speedTier: 'low',
        compatibleReasoningTiers: ['low', 'medium', 'high', 'xhigh', 'max'],
        compatibleServiceTiers: ['auto', 'standard_only'],
      },
    ]);
  });

  it('parseLineSeparatedModels prefixes default + dedupes', () => {
    const models = parseLineSeparatedModels('a\nb\nb\n# comment\n\nc');
    expect(models[0]?.id).toBe('default');
    expect(models.slice(1).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('parsePiModels handles tab-separated provider/model rows', () => {
    const stderr = [
      'provider\tmodel\tname',
      'anthropic\tclaude-sonnet-4-6\tClaude Sonnet 4.6',
      'openai\tgpt-5\tGPT-5',
    ].join('\n');
    const parsed = parsePiModels(stderr)!;
    expect(parsed[0]?.id).toBe('default');
    expect(parsed.slice(1).map((m) => m.id)).toContain(
      'anthropic/claude-sonnet-4-6',
    );
    expect(parsed.slice(1).map((m) => m.id)).toContain('openai/gpt-5');
  });

  it('parsePiModels returns null on empty input', () => {
    expect(parsePiModels('')).toBeNull();
  });
});

describe('clampCodexReasoning', () => {
  it('rewrites minimal → low for gpt-5.5 family', () => {
    expect(clampCodexReasoning('gpt-5.2', 'minimal')).toBe('low');
    expect(clampCodexReasoning('gpt-5.5', 'minimal')).toBe('low');
    expect(clampCodexReasoning(undefined, 'minimal')).toBe('low');
  });
  it('rewrites xhigh → high for gpt-5.1', () => {
    expect(clampCodexReasoning('gpt-5.1', 'xhigh')).toBe('high');
  });
  it('clamps gpt-5.1-codex-mini to medium|high', () => {
    expect(clampCodexReasoning('gpt-5.1-codex-mini', 'low')).toBe('medium');
    expect(clampCodexReasoning('gpt-5.1-codex-mini', 'minimal')).toBe('medium');
    expect(clampCodexReasoning('gpt-5.1-codex-mini', 'xhigh')).toBe('high');
  });
  it('passes through unknown ids unchanged', () => {
    expect(clampCodexReasoning('foo-bar', 'low')).toBe('low');
  });
});

describe('sanitizeCustomModel', () => {
  it('accepts valid ids', () => {
    expect(sanitizeCustomModel('anthropic/claude-sonnet-4.6')).toBe(
      'anthropic/claude-sonnet-4.6',
    );
    expect(sanitizeCustomModel('gpt-5')).toBe('gpt-5');
    expect(sanitizeCustomModel('o4-mini')).toBe('o4-mini');
  });

  it('rejects ids that look like flags or have whitespace', () => {
    expect(sanitizeCustomModel('--evil')).toBeNull();
    expect(sanitizeCustomModel('a b')).toBeNull();
    expect(sanitizeCustomModel(' leading')).toBe('leading'); // trim allowed
    expect(sanitizeCustomModel('')).toBeNull();
    expect(sanitizeCustomModel(123 as unknown as string)).toBeNull();
  });

  it('rejects ids over the length cap', () => {
    expect(sanitizeCustomModel('a'.repeat(201))).toBeNull();
  });
});

describe('isKnownModel + live cache', () => {
  it('accepts fallback models', () => {
    const claude = getAgentDef('claude')!;
    expect(isKnownModel(claude, 'sonnet')).toBe(true);
  });

  it('accepts ids from live cache', () => {
    const claude = getAgentDef('claude')!;
    rememberLiveModels('claude', [{ id: 'live-only', label: 'live' }]);
    expect(isKnownModel(claude, 'live-only')).toBe(true);
  });

  it('rejects unknown ids', () => {
    const claude = getAgentDef('claude')!;
    expect(isKnownModel(claude, 'never-seen')).toBe(false);
    expect(isKnownModel(claude, undefined)).toBe(false);
  });
});
