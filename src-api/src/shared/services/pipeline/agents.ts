/**
 * Pipeline Agent Roles
 *
 * Defines specialized agent roles following Anthropic's
 * Planner-Generator-Evaluator (PGE) pattern.
 *
 * Each role gets a tailored system prompt suffix, context mode,
 * and execution configuration. The evaluator uses a fresh context
 * window (separate session) to avoid self-bias.
 *
 * @see https://www.anthropic.com/engineering/harness-design-long-running-apps
 */

import type { SandboxConfig } from '@/core/agent';
import type { AgentMessage } from '@/core/agent/types';

import { createLogger } from '@/shared/utils/logger';

import { createSession, runAgent, runPlanningPhase } from '../agent';
import type { RepoConfig } from './repo-config';

const logger = createLogger('PipelineAgents');

// ============================================================================
// Types
// ============================================================================

export type AgentRole =
  | 'triage'
  | 'planner'
  | 'developer'
  | 'evaluator'
  | 'verifier'
  | 'ci_monitor';

export interface AgentRoleConfig {
  role: AgentRole;
  /** Appended to the agent's system prompt */
  systemPromptSuffix: string;
  /** Whether to auto-approve tool calls */
  autoApprove: boolean;
  /** Session phase for createSession() */
  sessionPhase: 'plan' | 'execute';
  /** Extended thinking config */
  thinkingConfig?: {
    type: 'adaptive' | 'enabled';
    budgetTokens?: number;
    effort?: 'medium' | 'high' | 'xhigh' | 'max';
  };
  /** Max agentic turns before stopping. Prevents runaway agents. */
  maxTurns: number;
}

export interface RunRoleAgentOptions {
  signal?: AbortSignal;
  modelConfig?: { apiKey?: string; baseUrl?: string; model?: string };
  sandboxConfig?: SandboxConfig;
  /** Additional context to prepend (e.g., CLAUDE.md, progress file) */
  contextPrefix?: string;
  /** Pre-discovered repo configuration for prompt enrichment */
  repoConfig?: RepoConfig;
}

// ============================================================================
// Role definitions
// ============================================================================

export const AGENT_ROLES: Record<AgentRole, AgentRoleConfig> = {
  triage: {
    role: 'triage',
    systemPromptSuffix: [
      'You are a triage agent. Classify the ticket:',
      '- Type: feature / bugfix / refactor / chore',
      '- Complexity: low (1-2 files) / medium (3-8 files) / high (9+ files)',
      '- Target repository and branch',
      '- Suggested branch name following convention: {type}/{identifier}-{scope}',
      '- Whether the ticket should be decomposed into sub-tasks',
      '- Confidence score (1-10) with reasoning',
      '',
      'Use the pipeline-triage skill for classification criteria.',
      'Output your analysis as structured text. Be concise.',
    ].join('\n'),
    autoApprove: true,
    sessionPhase: 'plan',
    maxTurns: 20,
  },

  planner: {
    role: 'planner',
    systemPromptSuffix: [
      'You are a planning agent following the Planner pattern.',
      'Create a detailed implementation plan:',
      '1. Goal and acceptance criteria',
      '2. Step-by-step implementation with specific file paths',
      '3. Test strategy (what to test, how to verify)',
      '4. Risk assessment (what could go wrong)',
      '5. Confidence score (1-10) with reasoning',
      '',
      'Be comprehensive but avoid over-specification.',
      'Focus on WHAT and WHY, not low-level HOW.',
      'Reference existing code patterns when possible.',
    ].join('\n'),
    autoApprove: true,
    sessionPhase: 'plan',
    thinkingConfig: { type: 'adaptive', effort: 'high' },
    maxTurns: 30,
  },

  developer: {
    role: 'developer',
    systemPromptSuffix: [
      'You are a development agent (Generator in PGE pattern).',
      'Implement changes according to the plan provided.',
      '',
      'Rules:',
      '- Follow existing code patterns and conventions',
      '- Write clean, tested code',
      '- Commit incrementally with descriptive messages',
      '- Do NOT evaluate your own work quality — a separate evaluator handles that',
      '- Do NOT add features beyond what the plan specifies',
      '- Run lint and type-check before considering implementation complete',
    ].join('\n'),
    autoApprove: true,
    sessionPhase: 'execute',
    maxTurns: 80,
  },

  evaluator: {
    role: 'evaluator',
    systemPromptSuffix: [
      'You are a standalone code evaluator (NOT the author of this code).',
      'You MUST be skeptical. Agents consistently overrate their own work.',
      '',
      'Review the diff against the acceptance criteria:',
      '1. CORRECTNESS: Does it actually solve the ticket? (pass/fail)',
      '2. SECURITY: No OWASP top 10 vulnerabilities introduced? (pass/fail)',
      '3. TESTS: Are tests adequate and passing? (pass/fail)',
      '4. CONVENTIONS: Follows project patterns from CLAUDE.md? (pass/fail)',
      '5. COMPLETENESS: All acceptance criteria met? (pass/fail)',
      '',
      'Score each criterion pass/fail. If ANY criterion fails, provide:',
      '- Specific file:line reference',
      '- What is wrong',
      '- How to fix it',
      '',
      'Do NOT be nice — be accurate. Do NOT give partial credit.',
      '',
      'Use the pipeline-evaluate skill for grading criteria.',
    ].join('\n'),
    autoApprove: false,
    sessionPhase: 'execute',
    thinkingConfig: { type: 'adaptive', effort: 'medium' },
    maxTurns: 30,
  },

  verifier: {
    role: 'verifier',
    systemPromptSuffix: [
      'You are a verification agent.',
      'Run lint, type-check, and tests. Fix any failures.',
      'If fixes introduce new issues, iterate until clean.',
      'Report the final status of each check.',
    ].join('\n'),
    autoApprove: true,
    sessionPhase: 'execute',
    maxTurns: 50,
  },

  ci_monitor: {
    role: 'ci_monitor',
    systemPromptSuffix: [
      'You are a CI/CD monitor agent.',
      'Check GitHub Actions status for the current PR.',
      'If checks fail:',
      '1. Read the failure logs',
      '2. Diagnose the root cause',
      '3. Fix the issue',
      '4. Commit and push',
      '5. Verify the fix passes',
      '',
      'Max 2 fix attempts. If still failing, report the issue.',
    ].join('\n'),
    autoApprove: true,
    sessionPhase: 'execute',
    maxTurns: 30,
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Run a pipeline agent with the specified role.
 *
 * The prompt is enriched with the role's system prompt suffix and
 * optional context prefix (CLAUDE.md, progress file, etc.).
 *
 * The evaluator runs in its own session to ensure fresh context
 * (PGE pattern: standalone evaluator with no self-bias).
 */
export async function* runRoleAgent(
  role: AgentRole,
  prompt: string,
  workDir: string,
  opts?: RunRoleAgentOptions,
): AsyncGenerator<AgentMessage> {
  const config = AGENT_ROLES[role];
  if (!config) throw new Error(`Unknown agent role: ${role}`);

  // Build enriched prompt
  const parts: string[] = [];

  // Prepend repo conventions from pre-discovered config
  if (opts?.repoConfig?.claudeMd && opts.repoConfig.conventions.length > 0) {
    parts.push('## Project Conventions');
    parts.push(...opts.repoConfig.conventions);
    parts.push('');
  }

  // Customize verifier instructions with repo-specific test command
  if (role === 'verifier' && opts?.repoConfig?.testCommand) {
    parts.push(`Test command: \`${opts.repoConfig.testCommand}\``);
    parts.push('');
  }

  // Prepend context (CLAUDE.md, progress file, etc.)
  if (opts?.contextPrefix) {
    parts.push(opts.contextPrefix);
    parts.push('---');
  }

  // Role instructions
  parts.push(config.systemPromptSuffix);
  parts.push('');

  // Enforce turn budget via prompt instruction
  parts.push(
    `IMPORTANT: You have a budget of ${config.maxTurns} tool-use turns for this task. ` +
      `Work efficiently and conclude within this limit.`,
  );
  parts.push('');

  // Task prompt
  parts.push(prompt);

  const enrichedPrompt = parts.join('\n');

  logger.info(`Running ${role} agent`, {
    workDir,
    promptLength: enrichedPrompt.length,
    autoApprove: config.autoApprove,
  });

  const session = createSession(config.sessionPhase);

  // Wire up abort signal
  if (opts?.signal) {
    opts.signal.addEventListener(
      'abort',
      () => session.abortController.abort(),
      { once: true },
    );
  }

  // Use planning phase for triage/planner roles
  if (config.sessionPhase === 'plan') {
    yield* runPlanningPhase(
      enrichedPrompt,
      session,
      workDir,
      opts?.modelConfig,
      undefined, // language
      undefined, // runtimeContext
      undefined, // agentProfileId
      undefined, // taskId
      undefined, // additionalUserDirs
      config.thinkingConfig,
    );
    return;
  }

  // Use runAgent for execution roles
  yield* runAgent(enrichedPrompt, {
    session,
    workDir,
    modelConfig: opts?.modelConfig,
    sandboxConfig: opts?.sandboxConfig,
    autoApprove: config.autoApprove,
    thinkingConfig: config.thinkingConfig,
    maxTurns: config.maxTurns,
  });
}
