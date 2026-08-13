/**
 * Slack Block Kit Progress Message
 *
 * Manages the lifecycle of a progress message using Block Kit blocks.
 * chat.update with blocks does NOT show "(edited)" — clean transitions.
 *
 * Design principles:
 *   - Consolidate repeated tool calls (e.g. "Checking video x12")
 *   - Fixed 2-block layout (section + context) to prevent UI bouncing
 *   - Current step shown with spinner dots animation
 *   - Throttled to 3s per Slack's AI best practices recommendation
 *
 * @see https://docs.slack.dev/reference/methods/chat.update/
 * @see https://docs.slack.dev/ai/ai-apps-best-practices/
 */

import type { ContextBlock, KnownBlock, SectionBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlackProgress');

/** Slack recommends once per 3s for AI app updates */
const MIN_UPDATE_INTERVAL_MS = 3_000;

// ============================================================================
// Types
// ============================================================================

export interface ToolStep {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
}

/** Consolidated display entry — groups repeated tool calls by label. */
interface DisplayEntry {
  label: string;
  status: 'in_progress' | 'complete' | 'error' | 'mixed';
  count: number;
  completedCount: number;
  errorCount: number;
}

// ============================================================================
// Progress Message
// ============================================================================

/**
 * Callback to set assistant thread status (shimmer + "is typing..." indicator).
 * Injected by the caller so SlackProgressMessage stays decoupled from SlackPlugin.
 */
export type SetThreadStatusFn = (
  status: string,
  loadingMessages?: string[],
) => Promise<void>;

export class SlackProgressMessage {
  private messageTs: string | null = null;
  private lastUpdateAt = 0;
  private steps: ToolStep[] = [];
  private startTime = Date.now();
  private hasPendingUpdate = false;
  private currentActivity = '';

  constructor(
    private readonly client: WebClient,
    private readonly channel: string,
    private readonly threadTs?: string,
    private readonly setThreadStatus?: SetThreadStatusFn,
  ) {}

  /** Post the initial progress message. Captures ts for future updates. */
  async start(text: string): Promise<void> {
    this.currentActivity = text;
    // Set the assistant thread status — shows shimmer + "is typing..."
    await this.setThreadStatus?.('Thinking...').catch(() => {});
    try {
      const result = await this.client.chat.postMessage({
        channel: this.channel,
        thread_ts: this.threadTs,
        text,
        blocks: this.buildBlocks(),
      });
      this.messageTs = result.ts ?? null;
      this.startTime = Date.now();
    } catch (err) {
      logger.warn('Failed to post progress message', { err });
    }
  }

  /** Add or update a progress step. Throttled to 3s intervals. */
  async updateStep(step: ToolStep): Promise<void> {
    const existing = this.steps.find((s) => s.id === step.id);
    if (existing) {
      existing.label = step.label;
      existing.status = step.status;
    } else {
      this.steps.push({ ...step });
    }

    // Update current activity label for the spinner + thread status
    if (step.status === 'in_progress') {
      this.currentActivity = step.label;
      // Push step-level status to the assistant thread indicator
      await this.setThreadStatus?.(`${step.label}...`).catch(() => {});
    }

    // Throttle: skip if last update was < 3s ago
    const now = Date.now();
    if (now - this.lastUpdateAt < MIN_UPDATE_INTERVAL_MS) {
      this.hasPendingUpdate = true;
      return;
    }
    await this.doUpdate();
  }

  /** Flush any pending update to Slack (call before complete). */
  async flush(): Promise<void> {
    if (this.hasPendingUpdate) {
      await this.doUpdate();
    }
  }

  /** Replace progress blocks with clean result blocks. */
  async complete(resultBlocks: KnownBlock[]): Promise<void> {
    // Clear the assistant thread status (shimmer + "is typing...")
    // Sending empty string explicitly clears it; it also auto-clears on reply,
    // but explicit clear is more reliable for edge cases.
    await this.setThreadStatus?.('').catch(() => {});
    if (!this.messageTs) return;
    try {
      await this.client.chat.update({
        channel: this.channel,
        ts: this.messageTs,
        text: 'Complete',
        blocks: resultBlocks,
      });
    } catch (err) {
      logger.warn('Failed to complete progress message', { err });
    }
  }

  get ts(): string | null {
    return this.messageTs;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private async doUpdate(): Promise<void> {
    if (!this.messageTs) return;
    this.lastUpdateAt = Date.now();
    this.hasPendingUpdate = false;

    try {
      const blocks = this.buildBlocks();
      await this.client.chat.update({
        channel: this.channel,
        ts: this.messageTs,
        text: this.currentActivity || 'Processing...',
        blocks,
      });
    } catch (err) {
      logger.warn('Progress update failed', { err });
    }
  }

  /**
   * Build exactly 2 blocks: a status section + a context line.
   * Fixed block count prevents Slack UI bouncing on updates.
   */
  private buildBlocks(): KnownBlock[] {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const entries = this.consolidateSteps();
    const hasActiveStep = this.steps.some((s) => s.status === 'in_progress');

    // Build status text — consolidated entries + current activity
    let statusText: string;
    if (entries.length === 0) {
      statusText = this.currentActivity || '...';
    } else {
      const lines = entries.map((e) => {
        const emoji = entryEmoji(e);
        const countSuffix = e.count > 1 ? ` (x${e.count})` : '';
        return `${emoji} ${e.label}${countSuffix}`;
      });
      // Show current activity as the last line if something is in progress
      if (hasActiveStep) {
        const activeLabel = this.currentActivity || 'Processing...';
        const alreadyShown = entries.some(
          (e) =>
            e.label === activeLabel &&
            (e.status === 'in_progress' || e.status === 'mixed'),
        );
        if (!alreadyShown) {
          lines.push(`\u23F3 ${activeLabel}...`);
        }
      }
      statusText = lines.join('\n');
    }

    const section: SectionBlock = {
      type: 'section',
      text: { type: 'mrkdwn', text: statusText },
    };

    // Context: step count + elapsed time
    const totalUnique = entries.length;
    const completedUnique = entries.filter(
      (e) => e.status === 'complete',
    ).length;
    const contextParts: string[] = [];
    if (totalUnique > 0) {
      contextParts.push(`${completedUnique}/${totalUnique} steps`);
    }
    contextParts.push(`${elapsed}s elapsed`);

    const context: ContextBlock = {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextParts.join(' \u2022 ') }],
    };

    return [section, context];
  }

  /**
   * Consolidate steps by label — group repeated tool calls.
   * e.g. 20x "Media check video" → one entry with count=20.
   */
  private consolidateSteps(): DisplayEntry[] {
    const groups = new Map<string, DisplayEntry>();

    for (const step of this.steps) {
      const existing = groups.get(step.label);
      if (existing) {
        existing.count++;
        if (step.status === 'complete') existing.completedCount++;
        if (step.status === 'error') existing.errorCount++;
        // Derive group status
        if (existing.errorCount > 0 && existing.completedCount > 0) {
          existing.status = 'mixed';
        } else if (existing.completedCount === existing.count) {
          existing.status = 'complete';
        } else if (existing.errorCount === existing.count) {
          existing.status = 'error';
        } else {
          existing.status = 'in_progress';
        }
      } else {
        groups.set(step.label, {
          label: step.label,
          status: step.status === 'pending' ? 'in_progress' : step.status,
          count: 1,
          completedCount: step.status === 'complete' ? 1 : 0,
          errorCount: step.status === 'error' ? 1 : 0,
        });
      }
    }

    return Array.from(groups.values());
  }
}

// ============================================================================
// Helpers
// ============================================================================

function entryEmoji(entry: DisplayEntry): string {
  switch (entry.status) {
    case 'in_progress':
      return '\u2022'; // •
    case 'complete':
      return '\u2022'; // •
    case 'error':
      return '\u2022'; // •
    case 'mixed':
      return '\u2022'; // •
  }
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Bash: 'Running command',
  Glob: 'Searching files',
  Grep: 'Searching code',
  // MCP: media-generation — domain-specific labels beat the generic
  // "Media check video" auto-derivation and give channel users a concrete
  // sense of what's happening during multi-minute renders.
  media_generate_image: 'Generating image',
  media_generate_video: 'Starting video render',
  media_check_video: 'Rendering video',
  media_generate_audio: 'Generating audio',
  media_transcribe: 'Transcribing audio',
};

/** Convert internal tool names to human-readable labels. */
export function humanizeToolName(name?: string): string {
  if (!name) return 'Processing';
  if (TOOL_LABELS[name]) return TOOL_LABELS[name]!;
  // MCP tools: mcp__server__tool_name → check stripped name for a domain
  // override first, then fall back to title-casing.
  const stripped = name.replace(/^mcp__[^_]+__/, '');
  if (TOOL_LABELS[stripped]) return TOOL_LABELS[stripped]!;
  return stripped.replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());
}

/**
 * Rotating loading messages shown under the Slack shimmer while a tool is
 * in flight. Slack rotates them every few seconds (Agents & AI Apps spec),
 * so channel users see movement even when a single tool call takes a while.
 * Returns undefined for tools that don't benefit from rotation (short ops).
 */
export function loadingMessagesForTool(name?: string): string[] | undefined {
  if (!name) return undefined;
  const stripped = name.replace(/^mcp__[^_]+__/, '');
  if (stripped === 'media_generate_video' || stripped === 'media_check_video') {
    return [
      'Rendering frames\u2026',
      'Applying motion\u2026',
      'Adding audio\u2026',
      'Finalizing video\u2026',
    ];
  }
  if (stripped === 'media_generate_image') {
    return ['Generating image\u2026', 'Applying style\u2026'];
  }
  if (stripped === 'media_generate_audio') {
    return ['Generating audio\u2026', 'Mixing\u2026'];
  }
  return undefined;
}
