/**
 * DesignMode conversational chat loop (Fix-sync Phase 02).
 *
 * Routes a design composer message through the existing agent runtime so the
 * project view is a real streaming agent conversation that *creates artifacts*
 * in the project workspace — rather than a one-shot media-dispatcher task that
 * only ever writes a markdown document. The agent writes files (e.g. a single
 * self-contained `index.html` for a prototype) into the project root, which the
 * FileWorkspace already watches and the FileViewer renders in a sandboxed
 * iframe.
 *
 * Media surfaces (image/video/audio) stay on the media dispatcher; this path is
 * for the agentic surfaces (prototype/deck/document/template). The caller picks
 * the route by surface.
 */

import { randomUUID } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';

import { ASK_USER_QUESTION_FENCE_LANG } from '@/core/agent/ask-user-question/instruction';
import { designBriefNeedsClarification } from '@/core/agent/clarification-policy';
import { createAgentFromConfig } from '@/core/agent/registry';
import { withToolResultLoopGuard } from '@/core/agent/tool-result-loop-guard';
import type {
  AgentMessage,
  AgentProvider,
  ConversationMessage,
} from '@/core/agent/types';

import { isOnDemandClarificationEnabled } from '@/shared/rollout/multi-mode-reliability';
import {
  getDesignSystem,
  readDesignSkillSeedTemplate,
} from '@/shared/services/design-mode/catalogs';
import { getProjectDir } from '@/shared/services/design-mode/fs';
import {
  addProjectOutput,
  getDesignProject,
} from '@/shared/services/design-mode/projects';
import type {
  DesignProject,
  DesignSurface,
} from '@/shared/services/design-mode/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DesignChat');

/** Cap the agent loop so a confused/looping run can't burn unbounded API spend. */
const DESIGN_CHAT_MAX_TURNS = 20;

/**
 * Watchdog: if the run yields no message within this window the spawned CLI is
 * almost certainly wedged in startup (e.g. an MCP server that never completes
 * its `initialize` handshake). Abort and surface an error instead of leaving
 * the UI on an infinite spinner. With `disableUserMcp` the first message
 * (session start) normally arrives within a few seconds, so this is generous.
 */
const DESIGN_CHAT_FIRST_TOKEN_TIMEOUT_MS = 90_000;

/** Abort a run that produced output but then stopped responding. */
const DESIGN_CHAT_IDLE_TIMEOUT_MS = 120_000;

const DESIGN_CHAT_FIRST_TOKEN_TIMEOUT = 'DESIGN_CHAT_FIRST_TOKEN_TIMEOUT';
const DESIGN_CHAT_IDLE_TIMEOUT = 'DESIGN_CHAT_IDLE_TIMEOUT';

/** Agentic surfaces that flow through the chat loop (not the media dispatcher). */
const CHAT_SURFACES: ReadonlySet<DesignSurface> = new Set<DesignSurface>([
  'prototype',
  'template',
  'deck',
  'document',
  'campaign',
]);

export function isChatSurface(surface: DesignSurface): boolean {
  return CHAT_SURFACES.has(surface);
}

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([iterator.next(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A per-surface instruction prefix so the agent emits the right artifact kind
 * and writes it into the project. Mirrors Open Design's per-skill output
 * contracts (e.g. the `web-prototype` skill → single self-contained HTML).
 */
function surfaceInstruction(surface: DesignSurface): string {
  switch (surface) {
    case 'prototype':
    case 'template':
      return [
        'You are working inside a design project workspace.',
        'Build a single, self-contained `index.html` (all CSS and JS inlined, no build step, no external dependencies except via CDN <script>/<link>) that fulfils the request.',
        'Write it to the project root with your file-write tool, then give a one or two sentence summary of what you built. Do not paste the full HTML back into the chat.',
      ].join(' ');
    case 'deck':
      return [
        'You are working inside a design project workspace.',
        'Build a single self-contained HTML slide deck `index.html` (inlined CSS/JS, keyboard-navigable slides).',
        'Write it to the project root, then briefly summarize the deck. Do not paste the full HTML back into the chat.',
      ].join(' ');
    case 'document':
    case 'campaign':
      return [
        'You are working inside a design project workspace.',
        'Write the document as Markdown to `artifacts/document.md` with your file-write tool, then briefly summarize it.',
      ].join(' ');
    default:
      return '';
  }
}

/**
 * The artifact a chat-surface run is expected to write, so we can register it
 * as a project output (→ Creations grid / provenance) and auto-open it once the
 * run finishes. Mirrors the per-surface `surfaceInstruction` output contracts.
 */
function expectedArtifact(
  surface: DesignSurface,
): { path: string; kind: string; mime: string } | null {
  switch (surface) {
    case 'prototype':
    case 'template':
    case 'deck':
      return { path: 'index.html', kind: surface, mime: 'text/html' };
    case 'document':
    case 'campaign':
      return {
        path: 'artifacts/document.md',
        kind: 'document',
        mime: 'text/markdown',
      };
    default:
      return null;
  }
}

/**
 * After a design-chat run, register the artifact the agent wrote into the
 * project root as a project output so it surfaces in the Creations grid and can
 * auto-open — but only if the file was actually (re)written by this run, i.e.
 * its mtime is newer than the most recent output already recorded for that
 * path. Returns the updated project when a new output was registered, else null.
 */
export async function harvestDesignChatArtifact(
  projectId: string,
  provider: string,
  model?: string,
): Promise<DesignProject | null> {
  const project = await getDesignProject(projectId);
  const expected = expectedArtifact(project.surface);
  if (!expected) return null;

  const root = getProjectDir(projectId, project.workspaceRoot);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(`${root}/${expected.path}`)).mtimeMs;
  } catch {
    return null; // Agent didn't write the expected artifact.
  }

  const latest = project.outputs
    .filter((o) => o.path === expected.path)
    .reduce<number>((max, o) => {
      const t = Date.parse(o.createdAt);
      return Number.isNaN(t) ? max : Math.max(max, t);
    }, 0);
  // A 1s slop absorbs filesystem mtime granularity vs. the recorded timestamp.
  if (mtimeMs <= latest + 1000) return null;

  return addProjectOutput(projectId, {
    id: `asset_${randomUUID().slice(0, 10)}`,
    kind: expected.kind,
    path: expected.path,
    mime: expected.mime,
    provider,
    model: model ?? 'auto',
    createdAt: new Date(mtimeMs).toISOString(),
  });
}

/**
 * Inject the project's selected design system (and any inspirations) into the
 * chat prompt so the agent actually builds in that brand — DESIGN.md prose, the
 * binding `tokens.css` `:root` contract, and a worked component fixture. Mirrors
 * the design-system sections in `prompt-composer.ts` so the chat loop reaches
 * the same fidelity as the media path. Returns '' when no system is selected.
 */
async function designSystemContext(project: DesignProject): Promise<string> {
  const system = project.designSystemId
    ? await getDesignSystem(project.designSystemId)
    : null;
  // allSettled (not all): a single malformed/unreadable inspiration id must
  // degrade gracefully rather than abort the whole chat run.
  const inspirations = (
    await Promise.allSettled(
      (project.inspirationDesignSystemIds ?? []).map((id) =>
        getDesignSystem(id),
      ),
    )
  ).flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));

  const parts: string[] = [];
  if (system) {
    parts.push(
      `## Active design system: ${system.title}\nBuild this artifact in the **${system.title}** design system. ${system.body}`,
    );
    if (system.tokenCss) {
      parts.push(
        [
          `### ${system.title} tokens (binding contract)`,
          "This is the brand's `tokens.css`. **Paste the unscoped `:root { ... }` block verbatim into the artifact's first `<style>`** so every `var(--*)` resolves. Do not invent or redefine tokens; do not write raw hex outside this block.",
          '```css',
          system.tokenCss,
          '```',
        ].join('\n'),
      );
    }
    if (system.componentsHtml) {
      parts.push(
        [
          `### ${system.title} reference fixture`,
          'A worked artifact in this design system. Match its component shapes (buttons, cards, type scale, focus ring, spacing cadence) and keep the `var(--*)` references intact.',
          '```html',
          system.componentsHtml,
          '```',
        ].join('\n'),
      );
    }
  }
  for (const insp of inspirations) {
    parts.push(
      `## Inspiration — ${insp.title}\nDraw visual influence (mood, palette, type, density) from ${insp.title}, but the active system above governs tokens. ${insp.summary}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Turn-1 clarification directive for a materially ambiguous fresh brief. The
 * agent asks only the blocking choices and stops; the answer turn then builds
 * with the completed context.
 */
function clarificationInstruction(project: DesignProject): string {
  return [
    `This ${project.surface} brief is too ambiguous to build responsibly. Ask only the smallest set of SHORT, specific questions that lock choices which materially change the artifact. Tailor them to THIS brief; do not ask generic boilerplate.`,
    `Emit them as the entire turn using exactly one fenced \`${ASK_USER_QUESTION_FENCE_LANG}\` block (one short friendly intro line before it is allowed). JSON schema:`,
    `\`\`\`${ASK_USER_QUESTION_FENCE_LANG}
{
  "questions": [
    {
      "question": "Full question, ends with ?",
      "header": "Short label (<=12 chars)",
      "options": [
        { "label": "Option A", "description": "What this means" },
        { "label": "Option B", "description": "What this means" }
      ],
      "multiSelect": false,
      "policy": {
        "behavior": "optional",
        "defaultOptionLabel": "Option A"
      }
    }
  ]
}
\`\`\``,
    'Rules: ask no more than the minimum needed (maximum 4), each with 2–4 options; use multiSelect:true where several apply; headers ≤12 chars. Optional questions must name a safe default. Mandatory approval, cost, rights, upload, and destructive-edit gates must use behavior "manual" with the matching gate and no default. Do NOT read files, run tools, write extended thinking, or build the artifact this turn — only ask. The next message will contain the answers; build then.',
  ].join('\n\n');
}

export interface DesignChatOptions {
  prompt: string;
  /** Agent provider id; validated against the registry, defaults to `claude`. */
  provider?: string;
  model?: string;
  sessionId?: string;
  /**
   * Prior turns as conversation history so the build turn has the brief + its
   * own discovery questions + the answers. Empty/absent ⇒ this is turn 1.
   */
  messages?: ConversationMessage[];
  /** Bounded prompt-only utility skills validated by the run-context boundary. */
  pinnedSkills?: string[];
  abortController?: AbortController;
}

/**
 * Default skill whose bundled `assets/template.html` seeds a fresh build when
 * the project has no skill bound. Per surface so a deck gets a deck seed, etc.
 */
const DEFAULT_SEED_SKILL_BY_SURFACE: Partial<Record<DesignSurface, string>> = {
  prototype: 'web-prototype',
  template: 'web-prototype',
  deck: 'simple-deck',
};

/**
 * Seed a fresh build's artifact from a skill template so the agent composes
 * from a structured base (and reads a file that exists). Uses the project's
 * bound skill when set, else the per-surface default. Returns false (caller
 * falls back to a direct create) for non-HTML artifacts, an unknown skill, or
 * a missing template — seeding is a best-effort optimisation, never required.
 */
async function seedArtifactTemplate(
  project: DesignProject,
  root: string,
  artifactPath: string,
): Promise<boolean> {
  if (artifactPath !== 'index.html') return false;
  const slug =
    project.skillId ?? DEFAULT_SEED_SKILL_BY_SURFACE[project.surface];
  if (!slug) return false;
  try {
    const seed = await readDesignSkillSeedTemplate(slug);
    if (!seed) return false;
    await writeFile(`${root}/${artifactPath}`, seed, 'utf8');
    logger.info(
      `[${project.id}] seeded ${artifactPath} from '${slug}' skill template (${seed.length} bytes)`,
    );
    return true;
  } catch (err) {
    logger.warn(
      `[${project.id}] could not seed ${artifactPath} from '${slug}' template: ${String(err)}`,
    );
    return false;
  }
}

/**
 * Run one design-chat turn, yielding the agent's `AgentMessage` stream. The
 * agent runs in the project's workspace with write access so its file-write
 * tools land artifacts the FileWorkspace surfaces.
 */
export async function* runDesignChat(
  projectId: string,
  options: DesignChatOptions,
): AsyncGenerator<AgentMessage> {
  const project = await getDesignProject(projectId);
  const root = getProjectDir(projectId, project.workspaceRoot);
  const provider = (options.provider as AgentProvider | undefined) ?? 'claude';

  const expected = expectedArtifact(project.surface);
  let exists = false;
  if (expected) {
    try {
      await stat(`${root}/${expected.path}`);
      exists = true;
    } catch {
      exists = false;
    }
  }
  // Ask only when a fresh brief is materially underspecified. Complete briefs
  // start building immediately.
  const isFirstTurn = (options.messages?.length ?? 0) === 0;
  const wantsClarification =
    Boolean(expected) &&
    !exists &&
    isFirstTurn &&
    (!isOnDemandClarificationEnabled() ||
      designBriefNeedsClarification(options.prompt));

  let prompt: string;
  if (wantsClarification) {
    prompt = [clarificationInstruction(project), '---', options.prompt].join(
      '\n\n',
    );
  } else {
    const instruction = surfaceInstruction(project.surface);
    // Three build states, each with the directive the agent actually follows:
    //  • genuine prior artifact → read it, edit in place (preserve the work);
    //  • fresh build → seed a skill template so the agent composes from a real
    //    token/class system and its read-before-write habit lands on a file
    //    that exists (Open Design's "copy the seed, then fill" model);
    //  • no template available → create directly without a failing read.
    let stateNote = '';
    if (expected) {
      const seeded = exists
        ? false
        : await seedArtifactTemplate(project, root, expected.path);
      if (exists) {
        stateNote = `An existing \`${expected.path}\` is present — read it first, then edit it in place to apply the request.`;
      } else if (seeded) {
        stateNote = `A starter \`${expected.path}\` (a seed template) is already in the project root — read it first, then build the requested design into it: keep its token/class system, replace the placeholder content, and bind the active design system. Write the finished page back to \`${expected.path}\`; do not paste the full file into the chat.`;
      } else {
        stateNote = `Create \`${expected.path}\` directly with your file-write tool — do not read it first (it does not exist yet).`;
      }
    }
    const designSystem = await designSystemContext(project);
    prompt = [instruction, designSystem, stateNote, '---', options.prompt]
      .filter(Boolean)
      .join('\n\n');
  }

  logger.info(
    `[${projectId}] design chat via ${provider} (surface=${project.surface}) in ${root}`,
  );

  const agent = createAgentFromConfig({
    provider,
    model: options.model,
    workDir: root,
  });

  // A design build is self-contained: it writes `index.html` (CDN deps only)
  // and reads nothing external, so it needs none of the user's MCP servers.
  // Skipping them (`disableUserMcp`) removes the dominant time-to-first-token
  // latency and the failure mode where the spawned CLI hangs indefinitely
  // waiting on a slow/unreachable user MCP server's `initialize` handshake.
  const abortController = options.abortController ?? new AbortController();
  const stream = withToolResultLoopGuard(
    agent.run(prompt, {
      runMode: 'design',
      sessionId: options.sessionId,
      conversation: options.messages,
      cwd: root,
      userWorkspaceDir: root,
      allowWorkspaceWrite: true,
      abortController,
      disableUserMcp: true,
      pinnedSkills: options.pinnedSkills,
      maxTurns: DESIGN_CHAT_MAX_TURNS,
    }),
  );

  // First-token watchdog (backstop): abort if the run produces nothing within
  // the budget rather than leaving the UI spinning forever on a startup stall.
  const iterator = stream[Symbol.asyncIterator]();
  let sawFirstMessage = false;
  try {
    while (true) {
      const result = await nextWithTimeout(
        iterator,
        sawFirstMessage
          ? DESIGN_CHAT_IDLE_TIMEOUT_MS
          : DESIGN_CHAT_FIRST_TOKEN_TIMEOUT_MS,
        sawFirstMessage
          ? DESIGN_CHAT_IDLE_TIMEOUT
          : DESIGN_CHAT_FIRST_TOKEN_TIMEOUT,
      );
      if (result.done) break;
      sawFirstMessage = true;
      yield result.value;
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === DESIGN_CHAT_FIRST_TOKEN_TIMEOUT ||
        err.message === DESIGN_CHAT_IDLE_TIMEOUT)
    ) {
      const firstTokenTimeout = err.message === DESIGN_CHAT_FIRST_TOKEN_TIMEOUT;
      const seconds = Math.round(
        (firstTokenTimeout
          ? DESIGN_CHAT_FIRST_TOKEN_TIMEOUT_MS
          : DESIGN_CHAT_IDLE_TIMEOUT_MS) / 1000,
      );
      logger.error(
        firstTokenTimeout
          ? `[${projectId}] design chat produced no output within ${seconds}s — aborting (likely MCP/startup stall)`
          : `[${projectId}] design chat was idle for ${seconds}s — aborting`,
      );
      abortController.abort();
      yield {
        type: 'error',
        subtype: firstTokenTimeout ? 'first_token_timeout' : 'idle_timeout',
        message: firstTokenTimeout
          ? `The design agent didn't start within ${seconds}s and was stopped. Please try again.`
          : `The design agent stopped responding for ${seconds}s and was stopped. Please try again.`,
      };
      yield { type: 'done' };
      return;
    }
    throw err;
  } finally {
    // Best-effort cleanup: signal the inner run to unwind (covers an early
    // consumer break). Never await it — a wedged run may never settle even
    // after abort, and blocking here would reintroduce the very hang the
    // watchdog exists to prevent. The timeout path above already aborted.
    void Promise.resolve(iterator.return?.(undefined)).catch(() => {});
  }
}
