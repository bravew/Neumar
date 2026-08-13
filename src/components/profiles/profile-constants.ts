/**
 * Profile dialog constants — role presets, model helpers, styling.
 * Extracted from ProfileDialog.tsx to stay under 350-line component limit.
 */

import { getSettings } from '@/shared/db/settings';

import type { ComboOption } from './Combobox';

// ============================================================================
// Shared styling constants
// ============================================================================

export const INPUT_CLASS =
  'bg-background border-input text-foreground placeholder:text-muted-foreground w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring';

export const SELECT_CLASS =
  'bg-background border-input text-foreground w-full cursor-pointer rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring';

export const LABEL_CLASS =
  'text-muted-foreground mb-1 block text-xs font-medium';

// ============================================================================
// Role presets with system prompt templates
// ============================================================================

export interface RolePreset {
  value: string;
  label: string;
  description: string;
  systemPrompt: string;
  icon: string;
}

export interface ProfileRoutingHints {
  channels?: string[];
  intents?: string[];
  chatPatterns?: string[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    value: 'Code Reviewer',
    label: 'Code Reviewer',
    description: 'Reviews pull requests and code quality',
    icon: 'scan-eye',
    systemPrompt:
      'You are a senior code reviewer. Analyze code for correctness, performance, security vulnerabilities, and adherence to best practices. Provide clear, actionable feedback with concrete suggestions for improvement.',
  },
  {
    value: 'Software Engineer',
    label: 'Software Engineer',
    description: 'Writes and maintains code',
    icon: 'code-2',
    systemPrompt:
      'You are an expert software engineer. Write clean, well-tested code that follows best practices. Break complex problems into manageable pieces, consider edge cases, and document your reasoning.',
  },
  {
    value: 'Technical Writer',
    label: 'Technical Writer',
    description: 'Creates documentation and guides',
    icon: 'book-open',
    systemPrompt:
      'You are a professional technical writer. Create clear, well-structured documentation tailored to the target audience. Use concise language, proper formatting, and include relevant examples where helpful.',
  },
  {
    value: 'Research Assistant',
    label: 'Research Assistant',
    description: 'Gathers and analyzes information',
    icon: 'search',
    systemPrompt:
      'You are a thorough research assistant. Investigate topics systematically, synthesize information from multiple angles, and present balanced findings. Cite sources and highlight areas of uncertainty.',
  },
  {
    value: 'Data Analyst',
    label: 'Data Analyst',
    description: 'Explores and visualizes data',
    icon: 'bar-chart-3',
    systemPrompt:
      'You are an expert data analyst. Help users explore, clean, and analyze data. Identify patterns and trends, suggest appropriate statistical methods, and communicate findings clearly with actionable insights.',
  },
  {
    value: 'UI/UX Developer',
    label: 'UI/UX Developer',
    description: 'Designs interfaces and components',
    icon: 'palette',
    systemPrompt:
      'You are a skilled UI/UX developer. Help design intuitive interfaces, build accessible React components, and apply modern design principles. Focus on usability, responsiveness, and visual consistency.',
  },
  {
    value: 'Project Planner',
    label: 'Project Planner',
    description: 'Plans tasks and milestones',
    icon: 'compass',
    systemPrompt:
      'You are an experienced project planner. Help break down complex projects into manageable tasks, estimate timelines, identify dependencies and risks, and create structured execution plans with clear milestones.',
  },
  {
    value: 'Test Engineer',
    label: 'Test Engineer',
    description: 'Writes and runs tests',
    icon: 'test-tube-2',
    systemPrompt:
      'You are a testing expert. Write comprehensive tests covering happy paths, edge cases, and error scenarios. Follow testing best practices, use appropriate mocking strategies, and ensure tests are maintainable.',
  },
  {
    value: 'Security Auditor',
    label: 'Security Auditor',
    description: 'Analyzes security vulnerabilities',
    icon: 'shield-check',
    systemPrompt:
      'You are a security auditor. Analyze code and configurations for security vulnerabilities including injection attacks, authentication flaws, data exposure, and misconfigurations. Provide severity ratings and remediation steps.',
  },
  {
    value: 'DevOps Engineer',
    label: 'DevOps Engineer',
    description: 'Manages infrastructure and CI/CD',
    icon: 'rocket',
    systemPrompt:
      'You are an experienced DevOps engineer. Help design CI/CD pipelines, containerize applications, configure cloud infrastructure, and implement monitoring. Focus on reliability, scalability, and automation.',
  },
];

/** Role i18n key map — maps preset value to locale key prefix. */
const ROLE_I18N_KEYS: Record<string, { label: string; desc: string }> = {
  'Code Reviewer': { label: 'roleCodeReviewer', desc: 'roleCodeReviewerDesc' },
  'Software Engineer': {
    label: 'roleSoftwareEngineer',
    desc: 'roleSoftwareEngineerDesc',
  },
  'Technical Writer': {
    label: 'roleTechnicalWriter',
    desc: 'roleTechnicalWriterDesc',
  },
  'Research Assistant': {
    label: 'roleResearchAssistant',
    desc: 'roleResearchAssistantDesc',
  },
  'Data Analyst': { label: 'roleDataAnalyst', desc: 'roleDataAnalystDesc' },
  'UI/UX Developer': {
    label: 'roleUiUxDeveloper',
    desc: 'roleUiUxDeveloperDesc',
  },
  'Project Planner': {
    label: 'roleProjectPlanner',
    desc: 'roleProjectPlannerDesc',
  },
  'Test Engineer': { label: 'roleTestEngineer', desc: 'roleTestEngineerDesc' },
  'Security Auditor': {
    label: 'roleSecurityAuditor',
    desc: 'roleSecurityAuditorDesc',
  },
  'DevOps Engineer': {
    label: 'roleDevOpsEngineer',
    desc: 'roleDevOpsEngineerDesc',
  },
};

/** Skill i18n key map — maps skill slug to locale key prefix. */
export const SKILL_I18N_KEYS: Record<string, { label: string; desc: string }> =
  {
    'code-review': { label: 'skillCodeReview', desc: 'skillCodeReviewDesc' },
    investigate: { label: 'skillInvestigate', desc: 'skillInvestigateDesc' },
    'security-audit': {
      label: 'skillSecurityAudit',
      desc: 'skillSecurityAuditDesc',
    },
    brainstorm: { label: 'skillBrainstorm', desc: 'skillBrainstormDesc' },
    'plan-review': { label: 'skillPlanReview', desc: 'skillPlanReviewDesc' },
    ship: { label: 'skillShip', desc: 'skillShipDesc' },
    'doc-update': { label: 'skillDocUpdate', desc: 'skillDocUpdateDesc' },
    retro: { label: 'skillRetro', desc: 'skillRetroDesc' },
  };

/** Build role combobox options with translated labels. */
export function getRoleComboOptions(
  profilesT: Record<string, unknown>,
): ComboOption[] {
  return ROLE_PRESETS.map((r) => {
    const keys = ROLE_I18N_KEYS[r.value];
    return {
      value: r.value,
      label: (keys && String(profilesT[keys.label] ?? '')) || r.label,
      description:
        (keys && String(profilesT[keys.desc] ?? '')) || r.description,
    };
  });
}

// ============================================================================
// Model options — runtime-aware
// ============================================================================

export interface ProviderInfo {
  type: string;
  name: string;
  available?: boolean;
  supportedModels?: string[];
  defaultModel?: string;
  /** Human-readable description of the runtime */
  description?: string;
  /** Transport mechanism: 'sdk' | 'cli' | 'http' | 'process' | 'a2a' */
  transport?: string;
  /** MCP support level: 'native' | 'shim' | 'none' */
  supportsMcp?: string;
  /** Skills support level: 'native' | 'none' */
  supportsSkills?: string;
  /** Whether the runtime supports planning mode */
  supportsPlan?: boolean;
  /** Whether a CLI binary must be installed locally */
  requiresBinary?: boolean;
  /** Whether an API key must be configured */
  requiresApiKey?: boolean;
}

/**
 * Returns true only for runtimes that natively support Claude's extended
 * thinking / thinking-config feature.
 */
export function runtimeSupportsThinking(runtimeId: string): boolean {
  return !runtimeId || runtimeId === 'claude';
}

/** A single capability badge descriptor */
export interface RuntimeCapability {
  label: string;
  title: string;
}

/** Build a list of capability badge descriptors for a provider. */
export function getProviderCapabilities(
  provider: ProviderInfo | undefined,
): RuntimeCapability[] {
  if (!provider) return [];
  const caps: RuntimeCapability[] = [];
  if (provider.supportsMcp === 'native')
    caps.push({ label: 'MCP', title: 'Native MCP server support' });
  else if (provider.supportsMcp === 'shim')
    caps.push({ label: 'MCP~', title: 'MCP via compatibility shim' });
  if (provider.supportsSkills === 'native')
    caps.push({ label: 'Skills', title: 'Native skills support' });
  if (provider.supportsPlan)
    caps.push({ label: 'Plan', title: 'Supports planning mode' });
  if (provider.requiresBinary)
    caps.push({ label: 'CLI', title: 'Requires CLI binary installed locally' });
  if (provider.requiresApiKey)
    caps.push({ label: 'API Key', title: 'Requires API key in Settings' });
  return caps;
}

/** Safely extract a string value from a locale object, falling back to a default. */
function tStr(
  obj: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const v = obj?.[key];
  return typeof v === 'string' ? v : fallback;
}

export function getModelsForRuntime(
  runtimeId: string,
  providers: ProviderInfo[],
  profilesT?: Record<string, unknown>,
): ComboOption[] {
  const provider = providers.find((p) => p.type === runtimeId);
  if (provider?.supportedModels && provider.supportedModels.length > 0) {
    return provider.supportedModels.map((id) => ({
      value: id,
      label: formatModelLabel(id),
      description: provider.name,
    }));
  }

  if (!runtimeId || runtimeId === 'claude') {
    return [
      {
        value: 'claude-sonnet-5',
        label: 'Sonnet 5',
        description: tStr(profilesT, 'modelBalanced', 'Balanced (default)'),
      },
      {
        value: 'claude-opus-5',
        label: 'Opus 5',
        description: tStr(profilesT, 'modelMostCapable', 'Most capable'),
      },
      {
        value: 'claude-fable-5',
        label: 'Fable 5',
        description: '',
      },
      {
        value: 'claude-opus-4-8',
        label: 'Opus 4.8',
        description: tStr(profilesT, 'modelMostCapable', 'Most capable'),
      },
      {
        value: 'claude-opus-4-7',
        label: 'Opus 4.7',
        description: tStr(profilesT, 'modelMostCapable', 'Most capable'),
      },
      {
        value: 'claude-sonnet-4-6',
        label: 'Sonnet 4.6',
        description: tStr(profilesT, 'modelBalanced', 'Balanced (default)'),
      },
      {
        value: 'claude-haiku-4-5-20251001',
        label: 'Haiku 4.5',
        description: tStr(profilesT, 'modelFast', 'Fast & lightweight'),
      },
    ];
  }

  try {
    const settings = getSettings();
    for (const p of settings.providers) {
      if (!p.enabled || !p.apiKey) continue;
      if (p.agentType === runtimeId || p.id === runtimeId) {
        return p.models.map((id) => ({
          value: id,
          label: formatModelLabel(id),
          description: p.name,
        }));
      }
    }
  } catch {
    // Settings unavailable
  }
  return [];
}

function formatModelLabel(id: string): string {
  // Claude models
  if (id.includes('fable-5')) return 'Fable 5';
  if (id.includes('mythos-5')) return 'Mythos 5';
  if (id.includes('sonnet-5')) return 'Sonnet 5';
  if (id.includes('opus-4-8')) return 'Opus 4.8';
  if (id.includes('sonnet-4-6')) return 'Sonnet 4.6';
  if (id.includes('opus-4-7')) return 'Opus 4.7';
  if (id.includes('opus-4-6')) return 'Opus 4.6';
  if (id.includes('haiku-4-5')) return 'Haiku 4.5';
  if (id.includes('sonnet-4-5')) return 'Sonnet 4.5';
  if (id.includes('sonnet-4')) return 'Sonnet 4';
  if (id.includes('opus-4')) return 'Opus 4';
  if (id.includes('3-5-sonnet')) return 'Sonnet 3.5';
  if (id.includes('3-5-haiku')) return 'Haiku 3.5';
  // Gemini / local aliases
  if (id === 'auto') return 'Auto';
  if (id === 'pro') return 'Pro';
  if (id === 'flash') return 'Flash';
  if (id === 'flash-lite') return 'Flash Lite';
  // OpenAI
  if (id === 'codex') return 'OpenAI Codex';
  if (id === 'gpt-5.5') return 'GPT-5.5';
  if (id === 'gpt-5.5-pro') return 'GPT-5.5 Pro';
  if (id === 'gpt-5.4') return 'GPT-5.4';
  if (id === 'gpt-5.4-mini') return 'GPT-5.4 Mini';
  if (id === 'gpt-5.3-codex') return 'GPT-5.3 Codex';
  if (id.startsWith('gpt-5')) return id.replace('gpt-', 'GPT-');
  if (id.startsWith('gpt-4o')) return 'GPT-4o';
  if (id.startsWith('gpt-4')) return 'GPT-4';
  if (id.startsWith('gpt-3.5')) return 'GPT-3.5 Turbo';
  // BytePlus / ModelArk
  if (id.startsWith('seed-1-8')) return 'Seed 1.8';
  if (id.startsWith('seed-1-6')) return 'Seed 1.6 Flash';
  if (id.startsWith('deepseek-v3')) return 'DeepSeek V3';
  if (id.startsWith('deepseek-r1')) return 'DeepSeek R1';
  if (id.startsWith('kimi-k2')) return 'Kimi K2';
  if (id.startsWith('deepseek')) return 'DeepSeek';
  if (id.startsWith('kimi')) return 'Kimi';
  if (id.startsWith('glm-4')) return 'GLM-4';
  if (id.startsWith('seedream-3')) return 'Seedream 3.0';
  if (id.startsWith('seedream-4-0')) return 'Seedream 4.0';
  if (id.startsWith('seedream-4-5')) return 'Seedream 4.5';
  if (id.startsWith('seedance-1-0-lite')) return 'Seedance 1.0 Lite';
  if (id.startsWith('seedance-1-0-pro')) return 'Seedance 1.0 Pro';
  if (id.startsWith('seedance-1-5')) return 'Seedance 1.5 Pro';
  if (id.startsWith('dreamina-seedance-2-0-fast')) return 'Seedance 2.0 Fast';
  if (id.startsWith('seedance-2')) return 'Seedance 2.0';
  return id;
}
