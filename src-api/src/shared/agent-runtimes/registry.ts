// Declarative registry of supported agent runtimes. Source of truth for
// detection, model probing, install/update guidance, and (Phase 5+)
// per-runtime arg construction. See doc-dev/plan/2026-05-02-agent-runtime-detection-install-update.md.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { buildPiRpcArgs } from '@/extensions/agent/pi-local/rpc';

import {
  DEFAULT_MODEL_OPTION,
  parseCursorAgentModels,
  parseLineSeparatedModels,
  parsePiModels,
  clampCodexReasoning,
  withModelSource,
} from './models.js';
import { readQwenConfiguredModelIds } from './qwen-settings.js';
import type {
  AgentRuntimeDef,
  ModelOption,
  RuntimeInstallOption,
  RuntimeUpdateOption,
} from './types.js';

const execFileP = promisify(execFile);
const QWEN_FALLBACK_MODELS: ModelOption[] = [
  DEFAULT_MODEL_OPTION,
  { id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' },
  { id: 'qwen3-coder-flash', label: 'qwen3-coder-flash' },
];

// ---------------------------------------------------------------------------
// Install / update option helpers
// ---------------------------------------------------------------------------

const NPM_NODE22_REQ = [
  {
    bin: 'node',
    versionRange: '>=22',
    reason: 'npm package requires Node.js 22+',
  },
];

const NPM_NODE20_REQ = [
  {
    bin: 'node',
    versionRange: '>=20',
    reason: 'npm package requires Node.js 20+',
  },
];

const NPM_REQ = [{ bin: 'npm', reason: 'npm CLI required for global install' }];

const BREW_REQ = [{ bin: 'brew', reason: 'Homebrew required' }];

export const QODER_RUNTIME_FEATURE_FLAG = 'NEUMA_AGENT_QODER';
export const KIMI_RUNTIME_FEATURE_FLAG = 'NEUMA_AGENT_KIMI';
export const ATOMCODE_RUNTIME_FEATURE_FLAG = 'NEUMA_AGENT_ATOMCODE';

export function isQoderRuntimeEnabled(): boolean {
  return process.env[QODER_RUNTIME_FEATURE_FLAG] === '1';
}

export function isKimiRuntimeEnabled(): boolean {
  return process.env[KIMI_RUNTIME_FEATURE_FLAG] === '1';
}

export function isAtomCodeRuntimeEnabled(): boolean {
  return process.env[ATOMCODE_RUNTIME_FEATURE_FLAG] === '1';
}

function npmGlobalInstall(
  pkg: string,
  requires = NPM_REQ,
): RuntimeInstallOption {
  return {
    id: 'npm-latest',
    label: 'Install with npm',
    command: 'npm',
    args: ['install', '-g', pkg],
    platforms: ['darwin', 'linux', 'win32'],
    requires,
    network: true,
    inAppRunnable: true,
    notes: 'Installs the latest version globally via npm.',
  };
}

function brewInstall(
  formula: string,
  platforms: NodeJS.Platform[] = ['darwin', 'linux'],
  cask = false,
): RuntimeInstallOption {
  const args = cask ? ['install', '--cask', formula] : ['install', formula];
  return {
    id: cask ? 'brew-cask' : 'brew-stable',
    label: cask ? 'Install with Homebrew (cask)' : 'Install with Homebrew',
    command: 'brew',
    args,
    platforms: cask ? ['darwin'] : platforms,
    requires: BREW_REQ,
    network: true,
    inAppRunnable: true,
  };
}

function brewUpgrade(formula: string, cask = false): RuntimeUpdateOption {
  const args = cask ? ['upgrade', '--cask', formula] : ['upgrade', formula];
  return {
    id: cask ? 'brew-cask-upgrade' : 'brew-upgrade',
    label: cask ? 'Upgrade with Homebrew (cask)' : 'Upgrade with Homebrew',
    command: 'brew',
    args,
    platforms: cask ? ['darwin'] : ['darwin', 'linux'],
    requires: BREW_REQ,
    network: true,
    inAppRunnable: true,
    kind: 'native',
  };
}

function nativeUpdate(
  bin: string,
  args: string[],
  label = 'Update via CLI',
): RuntimeUpdateOption {
  return {
    id: 'native-update',
    label,
    command: bin,
    args,
    platforms: ['darwin', 'linux', 'win32'],
    network: true,
    inAppRunnable: true,
    kind: 'native',
  };
}

function copyOnlyScript(
  id: string,
  label: string,
  command: string,
  args: string[],
  notes?: string,
): RuntimeInstallOption {
  return {
    id,
    label,
    command,
    args,
    platforms: ['darwin', 'linux'],
    network: true,
    inAppRunnable: false,
    notes:
      notes ||
      'Copy this command into your terminal — third-party install scripts are not run inside the app.',
  };
}

// ---------------------------------------------------------------------------
// Auth probes (best-effort)
// ---------------------------------------------------------------------------

const CURSOR_AUTH_REQUIRED_RE =
  /authentication required|not (logged|signed) in|run '?agent login'?|no models available/i;

/**
 * Probe Cursor Agent auth with `cursor-agent models` — a cheap,
 * side-effect-free command that exercises the same headless auth path as
 * `--print` runs. `cursor-agent status` is NOT trustworthy here: it can
 * report "Login successful!" from a stale IDE token while every headless
 * command fails with "Authentication required" (observed 2026-07). Declaring
 * a probe is what makes detection surface an "auth required" badge (the
 * generalized probe only runs for defs that opt in).
 */
async function probeCursorAgentAuth(resolvedBin: string) {
  // An explicit API key/token in the app's environment satisfies headless
  // auth on its own (the CLI's own guidance: "run 'agent login' … or set
  // CURSOR_API_KEY"), so skip the probe — mirrors Open Design's
  // key-satisfies-probe short-circuit.
  if (
    process.env['CURSOR_API_KEY']?.trim() ||
    process.env['CURSOR_AUTH_TOKEN']?.trim()
  ) {
    return {
      state: 'authenticated' as const,
      detail: 'CURSOR_API_KEY is set for the app',
    };
  }
  const unauthenticated = {
    state: 'unauthenticated' as const,
    detail:
      'Run `cursor-agent login` in a terminal (or set CURSOR_API_KEY in the app environment), then rescan.',
  };
  try {
    const { stdout, stderr } = await execFileP(resolvedBin, ['models'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const text = `${stdout}\n${stderr}`;
    if (CURSOR_AUTH_REQUIRED_RE.test(text)) return unauthenticated;
    // Exit 0 without an auth complaint and with a parseable model list is
    // proof of working headless auth (the authed CLI prints `<id> - <Label>`
    // lines under an `Available models` header).
    if (parseCursorAgentModels(stdout)) {
      return { state: 'authenticated' as const, detail: 'Headless auth OK' };
    }
    return { state: 'unknown' as const };
  } catch (err) {
    // Non-zero exit lands here; the error message carries stdout/stderr.
    if (CURSOR_AUTH_REQUIRED_RE.test(String(err))) return unauthenticated;
    return { state: 'unknown' as const };
  }
}

async function probeClaudeAuth(resolvedBin: string) {
  try {
    const { stdout } = await execFileP(resolvedBin, ['auth', 'status'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const text = stdout.toLowerCase();
    if (/logged in|authenticated|signed in/.test(text)) {
      return {
        state: 'authenticated' as const,
        detail: stdout.trim().split('\n')[0],
      };
    }
    if (/not (logged|signed) in|unauthenticated/.test(text)) {
      return { state: 'unauthenticated' as const };
    }
    return { state: 'unknown' as const };
  } catch {
    return { state: 'unknown' as const };
  }
}

// ---------------------------------------------------------------------------
// AGENT_DEFS — single source of truth
// ---------------------------------------------------------------------------

const QODER_RUNTIME_DEF: AgentRuntimeDef = {
  id: 'qoder',
  name: 'Qoder CLI (experimental)',
  bin: 'qodercli',
  versionArgs: ['--version'],
  fallbackModels: [DEFAULT_MODEL_OPTION],
  promptDelivery: 'argv',
  windowsMaxPromptArgBytes: 30_000,
  streamFormat: 'plain',
  install: [
    npmGlobalInstall('@qoder-ai/qodercli'),
    copyOnlyScript(
      'install-script',
      'Install via qoder.com script',
      'sh',
      ['-c', 'curl -fsSL https://qoder.com/install | bash'],
      'Qoder CLI also supports this official install script. Copy it into a terminal after reviewing the source.',
    ),
    brewInstall('qoderai/qoder/qodercli', ['darwin'], true),
  ],
  update: [
    {
      id: 'npm-latest',
      label: 'Reinstall with npm',
      command: 'npm',
      args: ['install', '-g', '@qoder-ai/qodercli@latest'],
      platforms: ['darwin', 'linux', 'win32'],
      requires: NPM_REQ,
      network: true,
      inAppRunnable: true,
      kind: 'reinstall',
    },
    brewUpgrade('qoderai/qoder/qodercli', true),
  ],
};

const KIMI_RUNTIME_DEF: AgentRuntimeDef = {
  id: 'kimi',
  name: 'Kimi Code CLI (experimental)',
  bin: 'kimi',
  versionArgs: ['--version'],
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'kimi-code/k3', label: 'Kimi K3' },
  ],
  buildArgs: () => ['acp'],
  promptDelivery: 'stdin',
  streamFormat: 'acp-json-rpc',
  capabilities: {
    modes: {
      task: 'experimental',
      design: 'experimental',
      video: 'unsupported',
    },
    toolApproval: 'host-mediated',
    mcpInjection: 'native',
    sessionContinuation: 'acp-load',
  },
  install: [
    copyOnlyScript(
      'official-script',
      'Install with official Kimi Code script',
      'sh',
      ['-c', 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash'],
      'Copy this command into a terminal after reviewing the official installer.',
    ),
    npmGlobalInstall('@moonshot-ai/kimi-code@latest', NPM_NODE22_REQ),
  ],
  update: [
    nativeUpdate('kimi', ['upgrade'], 'Upgrade via Kimi Code'),
    {
      id: 'npm-latest',
      label: 'Reinstall with npm',
      command: 'npm',
      args: ['install', '-g', '@moonshot-ai/kimi-code@latest'],
      platforms: ['darwin', 'linux', 'win32'],
      requires: NPM_NODE22_REQ,
      network: true,
      inAppRunnable: true,
      kind: 'reinstall',
    },
  ],
};

const ATOMCODE_RUNTIME_DEF: AgentRuntimeDef = {
  id: 'atomcode',
  name: 'AtomCode CLI (experimental)',
  bin: 'atomcode',
  versionArgs: ['--version'],
  fallbackModels: [
    DEFAULT_MODEL_OPTION,
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'glm-5.2', label: 'GLM-5.2' },
    { id: 'deepseek-v4', label: 'DeepSeek V4' },
  ],
  buildArgs: (_prompt, _images, _dirs, options, context) => {
    if (!context.promptFilePath) {
      throw new Error('atomcode requires runtimeContext.promptFilePath');
    }
    const args = [
      '--prompt-file',
      context.promptFilePath,
      '--max-turns',
      '20',
      '--disabled-tools',
      'shell,network',
    ];
    if (options.model && options.model !== DEFAULT_MODEL_OPTION.id) {
      args.push('--model', options.model);
    }
    return args;
  },
  promptDelivery: 'file',
  streamFormat: 'plain',
  install: [
    npmGlobalInstall('@atomgit.com/atomcode'),
    brewInstall('atomcode', ['darwin'], true),
  ],
  capabilities: {
    modes: {
      task: 'experimental',
      design: 'experimental',
      video: 'unsupported',
    },
    toolApproval: 'none',
    mcpInjection: 'none',
    sessionContinuation: 'none',
  },
};

export const AGENT_DEFS: AgentRuntimeDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    helpArgs: ['-p', '--help'],
    capabilityFlags: {
      '--include-partial-messages': 'partialMessages',
      '--add-dir': 'addDir',
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'best', label: 'Best (alias)' },
      { id: 'sonnet', label: 'Sonnet (alias)' },
      { id: 'opus', label: 'Opus (alias)' },
      { id: 'haiku', label: 'Haiku (alias)' },
      { id: 'claude-sonnet-5', label: 'claude-sonnet-5' },
      {
        id: 'claude-opus-5',
        label: 'claude-opus-5',
        contextWindowTokens: 1_000_000,
        capabilityTags: ['chat', 'vision', 'reasoning', 'code'],
        costTier: 'high',
        speedTier: 'low',
        compatibleReasoningTiers: ['low', 'medium', 'high', 'xhigh', 'max'],
        compatibleServiceTiers: ['auto', 'standard_only'],
      },
      {
        id: 'claude-fable-5',
        label: 'claude-fable-5',
        contextWindowTokens: 1_000_000,
        capabilityTags: ['chat', 'vision', 'reasoning', 'code'],
        costTier: 'high',
        speedTier: 'medium',
        compatibleReasoningTiers: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      { id: 'claude-opus-4-8', label: 'claude-opus-4-8' },
      { id: 'claude-opus-4-7', label: 'claude-opus-4-7' },
      { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
    ],
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'claude-stream-json',
    capabilities: {
      modes: { task: 'supported', design: 'supported', video: 'supported' },
      toolApproval: 'host-mediated',
      mcpInjection: 'native',
      sessionContinuation: 'by-id',
    },
    install: [
      npmGlobalInstall('@anthropic-ai/claude-code'),
      brewInstall('claude-code', ['darwin'], true),
    ],
    update: [
      nativeUpdate('claude', ['update'], 'Update via claude'),
      brewUpgrade('claude-code', true),
      {
        id: 'npm-latest',
        label: 'Reinstall with npm',
        command: 'npm',
        args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
        platforms: ['darwin', 'linux', 'win32'],
        requires: NPM_REQ,
        network: true,
        inAppRunnable: true,
        kind: 'reinstall',
      },
    ],
    authProbe: probeClaudeAuth,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gpt-5.5', label: 'gpt-5.5' },
      { id: 'gpt-5.4', label: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
      { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
      { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
      { id: 'o3', label: 'o3' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'codex',
    capabilities: {
      modes: { task: 'supported', design: 'supported', video: 'supported' },
      toolApproval: 'host-mediated',
      mcpInjection: 'native',
      sessionContinuation: 'by-id',
    },
    install: [
      npmGlobalInstall('@openai/codex'),
      brewInstall('codex', ['darwin'], true),
    ],
    update: [
      nativeUpdate('codex', ['update'], 'Update via codex'),
      brewUpgrade('codex', true),
      {
        id: 'npm-latest',
        label: 'Reinstall with npm',
        command: 'npm',
        args: ['install', '-g', '@openai/codex@latest'],
        platforms: ['darwin', 'linux', 'win32'],
        requires: NPM_REQ,
        network: true,
        inAppRunnable: true,
        kind: 'reinstall',
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    ],
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'gemini',
    install: [
      npmGlobalInstall('@google/gemini-cli'),
      brewInstall('gemini-cli'),
    ],
    update: [
      brewUpgrade('gemini-cli'),
      {
        id: 'npm-latest',
        label: 'Reinstall with npm',
        command: 'npm',
        args: ['install', '-g', '@google/gemini-cli@latest'],
        platforms: ['darwin', 'linux', 'win32'],
        requires: NPM_REQ,
        network: true,
        inAppRunnable: true,
        kind: 'reinstall',
      },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode',
    versionArgs: ['--version'],
    listModels: {
      args: ['models'],
      parse: parseLineSeparatedModels,
      timeoutMs: 15_000,
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      {
        id: 'anthropic/claude-sonnet-5',
        label: 'anthropic/claude-sonnet-5',
      },
      {
        id: 'anthropic/claude-opus-5',
        label: 'anthropic/claude-opus-5',
      },
      {
        id: 'anthropic/claude-opus-4-8',
        label: 'anthropic/claude-opus-4-8',
      },
      {
        id: 'anthropic/claude-sonnet-4-6',
        label: 'anthropic/claude-sonnet-4-6',
      },
      { id: 'openai/gpt-5.5', label: 'openai/gpt-5.5' },
      { id: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
    ],
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'opencode',
    install: [
      npmGlobalInstall('opencode-ai'),
      copyOnlyScript('install-script', 'Install via opencode.ai script', 'sh', [
        '-c',
        'curl -fsSL https://opencode.ai/install | bash',
      ]),
    ],
    update: [nativeUpdate('opencode', ['upgrade'], 'Upgrade via opencode')],
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor-agent',
    versionArgs: ['--version'],
    // `cursor-agent models` prints an `Available models` header plus
    // `<id> - <Label>` lines when authed, or "No models available for this
    // account." when not — the latter is not a model list, so fall back.
    listModels: {
      args: ['models'],
      timeoutMs: 5000,
      parse: (stdout) => {
        const trimmed = String(stdout || '').trim();
        if (!trimmed || /no models available/i.test(trimmed)) return null;
        return parseCursorAgentModels(trimmed);
      },
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'auto', label: 'auto' },
      { id: 'sonnet-4', label: 'sonnet-4' },
      { id: 'sonnet-4-thinking', label: 'sonnet-4-thinking' },
      { id: 'gpt-5', label: 'gpt-5' },
    ],
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'json-event-stream',
    eventParser: 'cursor-agent',
    capabilities: {
      modes: { task: 'supported', design: 'supported', video: 'supported' },
      toolApproval: 'runtime-native',
      mcpInjection: 'workspace-config',
      sessionContinuation: 'by-id',
    },
    install: [
      {
        id: 'install-script',
        label: 'Install via cursor.com script',
        command: 'sh',
        args: ['-c', 'curl https://cursor.com/install -fsS | bash'],
        platforms: ['darwin', 'linux'],
        network: true,
        inAppRunnable: true,
        notes:
          'Pinned to https://cursor.com — same trust level as npm-global vendor installs.',
      },
    ],
    update: [
      {
        id: 'install-script',
        label: 'Update via cursor.com script (recommended)',
        command: 'sh',
        args: ['-c', 'curl https://cursor.com/install -fsS | bash'],
        platforms: ['darwin', 'linux'],
        network: true,
        inAppRunnable: true,
        kind: 'reinstall',
        notes:
          'cursor-agent self-update is currently unreliable; the official install script is the canonical recovery path.',
      },
      nativeUpdate('cursor-agent', ['update'], 'Update via cursor-agent'),
    ],
    authProbe: probeCursorAgentAuth,
  },
  ...(isQoderRuntimeEnabled() ? [QODER_RUNTIME_DEF] : []),
  ...(isKimiRuntimeEnabled() ? [KIMI_RUNTIME_DEF] : []),
  ...(isAtomCodeRuntimeEnabled() ? [ATOMCODE_RUNTIME_DEF] : []),
  {
    id: 'qwen',
    name: 'Qwen Code',
    bin: 'qwen',
    versionArgs: ['--version'],
    fallbackModels: QWEN_FALLBACK_MODELS,
    fetchModels: async () => {
      const configured = await readQwenConfiguredModelIds();
      if (configured.length === 0) return null;
      const seen = new Set(configured);
      return [
        ...configured.map((id) => ({
          id,
          label: id,
          source: 'configured' as const,
        })),
        ...QWEN_FALLBACK_MODELS.filter((model) => !seen.has(model.id)).map(
          (model) => ({ ...model, source: 'fallback' as const }),
        ),
      ];
    },
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'plain',
    capabilities: {
      modes: { task: 'supported', design: 'supported', video: 'unsupported' },
      toolApproval: 'runtime-native',
      mcpInjection: 'none',
      sessionContinuation: 'none',
    },
    install: [
      npmGlobalInstall('@qwen-code/qwen-code@latest', NPM_NODE20_REQ),
      brewInstall('qwen-code'),
    ],
    update: [
      {
        id: 'npm-latest',
        label: 'Reinstall with npm',
        command: 'npm',
        args: ['install', '-g', '@qwen-code/qwen-code@latest'],
        platforms: ['darwin', 'linux', 'win32'],
        requires: NPM_NODE20_REQ,
        network: true,
        inAppRunnable: true,
        kind: 'reinstall',
      },
      brewUpgrade('qwen-code'),
    ],
  },
  {
    id: 'devin',
    name: 'Devin for Terminal',
    bin: 'devin',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'adaptive', label: 'adaptive' },
      { id: 'swe', label: 'swe' },
      { id: 'opus', label: 'opus' },
      { id: 'sonnet', label: 'sonnet' },
      { id: 'codex', label: 'codex' },
      { id: 'gpt', label: 'gpt' },
      { id: 'gemini', label: 'gemini' },
    ],
    promptDelivery: 'stdin',
    streamFormat: 'acp-json-rpc',
  },
  {
    id: 'kilo',
    name: 'Kilo',
    bin: 'kilo',
    versionArgs: ['--version'],
    fallbackModels: [DEFAULT_MODEL_OPTION],
    promptDelivery: 'stdin',
    streamFormat: 'acp-json-rpc',
  },
  {
    id: 'vibe',
    name: 'Mistral Vibe CLI',
    bin: 'vibe-acp',
    versionArgs: ['--version'],
    fallbackModels: [DEFAULT_MODEL_OPTION],
    promptDelivery: 'stdin',
    streamFormat: 'acp-json-rpc',
  },
  {
    id: 'trae-cli',
    name: 'Trae CLI',
    bin: 'traecli',
    versionArgs: ['--version'],
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: () => ['acp', 'serve', '--yolo'],
    promptDelivery: 'stdin',
    streamFormat: 'acp-json-rpc',
    install: [
      copyOnlyScript(
        'install-docs',
        'Install from Trae CLI docs',
        'sh',
        [
          '-c',
          'printf %s\\n "https://www.volcengine.com/docs/86677/2227861?lang=zh"',
        ],
        'Trae CLI installation is documented by Volcengine. Review the docs and install the traecli binary, then rescan runtimes.',
      ),
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek TUI',
    bin: 'deepseek',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
    ],
    promptDelivery: 'argv',
    windowsMaxPromptArgBytes: 30_000,
    streamFormat: 'plain',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    bin: 'copilot',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
    ],
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'copilot-stream-json',
    capabilities: {
      modes: { task: 'supported', design: 'supported', video: 'unsupported' },
      toolApproval: 'runtime-native',
      mcpInjection: 'none',
      sessionContinuation: 'by-id',
    },
    install: [
      npmGlobalInstall('@github/copilot', NPM_NODE22_REQ),
      brewInstall('copilot-cli', ['darwin'], true),
    ],
    update: [
      brewUpgrade('copilot-cli', true),
      {
        id: 'npm-latest',
        label: 'Reinstall with npm',
        command: 'npm',
        args: ['install', '-g', '@github/copilot@latest'],
        platforms: ['darwin', 'linux', 'win32'],
        requires: NPM_NODE22_REQ,
        network: true,
        inAppRunnable: true,
        kind: 'reinstall',
      },
    ],
  },
  {
    id: 'kiro',
    name: 'Kiro CLI',
    bin: 'kiro-cli',
    versionArgs: ['--version'],
    fallbackModels: [DEFAULT_MODEL_OPTION],
    promptDelivery: 'stdin',
    streamFormat: 'acp-json-rpc',
    install: [
      copyOnlyScript(
        'install-script',
        'Install via cli.kiro.dev script',
        'sh',
        ['-c', 'curl -fsSL https://cli.kiro.dev/install | bash'],
      ),
    ],
  },
  {
    id: 'hermes',
    name: 'Hermes',
    bin: 'hermes',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'openai-codex:gpt-5.5', label: 'gpt-5.5 (openai-codex:gpt-5.5)' },
      { id: 'openai-codex:gpt-5.4', label: 'gpt-5.4 (openai-codex:gpt-5.4)' },
      {
        id: 'openai-codex:gpt-5.4-mini',
        label: 'gpt-5.4-mini (openai-codex:gpt-5.4-mini)',
      },
    ],
    promptDelivery: 'stdin',
    streamFormat: 'acp-json-rpc',
    install: [
      copyOnlyScript(
        'pipx-install',
        'Install via pipx (recommended)',
        'pipx',
        ['install', 'hermes-acp'],
        'Hermes is a Python tool — pipx is the recommended installer. Install pipx first if not present.',
      ),
    ],
  },
  {
    id: 'pi',
    name: 'Pi',
    bin: 'pi',
    versionArgs: ['--version'],
    fetchModels: async (resolvedBin) => {
      try {
        const { stderr } = await execFileP(resolvedBin, ['--list-models'], {
          timeout: 20000,
          maxBuffer: 8 * 1024 * 1024,
        });
        const parsed = parsePiModels(stderr);
        if (!parsed || parsed.length === 0) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      {
        id: 'anthropic/claude-sonnet-5',
        label: 'Claude Sonnet 5 (anthropic)',
      },
      {
        id: 'anthropic/claude-opus-4-8',
        label: 'Claude Opus 4.8 (anthropic)',
      },
      {
        id: 'anthropic/claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6 (anthropic)',
      },
      { id: 'anthropic/claude-opus-4-7', label: 'Claude Opus 4.7 (anthropic)' },
      { id: 'openai/gpt-5.5', label: 'GPT-5.5 (openai)' },
      { id: 'openai/o4-mini', label: 'o4-mini (openai)' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (google)' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (google)' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'off', label: 'Off' },
      { id: 'minimal', label: 'Minimal' },
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'XHigh' },
    ],
    buildArgs: (
      _prompt,
      _imagePaths,
      extraAllowedDirs = [],
      options = {},
      _runtimeContext = {},
    ) =>
      buildPiRpcArgs({
        model: options.model,
        reasoning: options.reasoning,
        extraAllowedDirs,
      }),
    promptDelivery: 'stdin',
    promptViaStdin: true,
    streamFormat: 'pi-rpc',
  },
];

export function getAgentDef(id: string): AgentRuntimeDef | null {
  return AGENT_DEFS.find((a) => a.id === id) ?? null;
}

// Re-export utilities so consumers can hit a single import point.
export {
  clampCodexReasoning,
  parseCursorAgentModels,
  parseLineSeparatedModels,
  parsePiModels,
};

// Strip closures + probe-only metadata before serializing to API clients.
export function stripFns(
  def: AgentRuntimeDef,
): Omit<
  AgentRuntimeDef,
  | 'buildArgs'
  | 'listModels'
  | 'fetchModels'
  | 'fallbackModels'
  | 'helpArgs'
  | 'capabilityFlags'
  | 'authProbe'
> {
  // We rebuild explicitly so TS knows about the omitted keys.
  const {
    id,
    name,
    bin,
    versionArgs,
    promptDelivery,
    promptViaStdin,
    windowsMaxPromptArgBytes,
    streamFormat,
    eventParser,
    reasoningOptions,
    install,
    update,
  } = def;
  return {
    id,
    name,
    bin,
    versionArgs,
    promptDelivery,
    promptViaStdin,
    windowsMaxPromptArgBytes,
    streamFormat,
    eventParser,
    reasoningOptions,
    install,
    update,
  };
}

export function fallbackModelsFor(def: AgentRuntimeDef): ModelOption[] {
  return withModelSource(
    def.fallbackModels.length > 0 ? def.fallbackModels : [DEFAULT_MODEL_OPTION],
    'fallback',
  );
}
