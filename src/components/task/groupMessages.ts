/**
 * Message grouping for the task thread.
 *
 * Pure functions that fold a flat AG-UI message array into the item list the
 * virtualized thread renders. Kept out of the component file so the algorithm
 * can be unit-tested and reasoned about on its own.
 */
import {
  MEDIA_DOWNLOAD_ACTIVITY,
  DOWNLOAD_MEDIA_TOOL,
  type DownloadActivity,
  downloadActivitySchema,
} from '@neumar/video-ir';

import type { Artifact } from '@/components/artifacts/types';
import {
  readPlanActivity,
  type PlanActivity,
} from '@/components/task/planActivity';
import {
  readStatusActivity,
  type StatusActivity,
} from '@/components/task/statusActivity';
import type {
  ActivityEntry,
  AGUIMessage,
  AGUIToolCall,
} from '@/components/task/TaskV2MessageBubble.types';
import {
  getToolName,
  shortToolName,
} from '@/components/task/TaskV2MessageBubble.types';
import type { PermissionRequest, TaskPlan } from '@/shared/hooks/agent-types';
import type { BranchMeta } from '@/shared/stores/branch-store';

/** Unwrap a ```json … ``` fence, if the whole string is one. */
const JSON_FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;

/**
 * Detect raw JSON plan objects from the agent stream (shown via plan-approval
 * card). The live stream emits the bare object, but the persisted copy comes
 * back fence-wrapped — without unwrapping, a replayed thread opens with the
 * plan JSON rendered as a code block.
 */
function isPlanJson(content: string): boolean {
  let trimmed = content.trim();
  const fenced = trimmed.match(JSON_FENCE_RE);
  if (fenced) trimmed = fenced[1].trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && parsed.type === 'plan';
  } catch {
    return false;
  }
}

// ── Grouped item types ───────────────────────────────────────────────────────

export type GroupedItem =
  | { type: 'download-widget'; key: string; activity: DownloadActivity }
  | { type: 'message'; key: string; msg: AGUIMessage }
  | {
      type: 'tool-group';
      key: string;
      toolCalls: AGUIToolCall[];
    }
  | {
      type: 'activity';
      key: string;
      entries: ActivityEntry[];
    }
  | {
      type: 'status-widget';
      key: string;
      status: StatusActivity;
    }
  | {
      type: 'plan-widget';
      key: string;
      plan: PlanActivity;
    }
  | {
      type: 'plan-approval';
      key: string;
      plan: TaskPlan;
      isWaitingApproval: boolean;
    }
  | {
      type: 'branch-nav';
      key: string;
      forkPointId: string | number;
      branches: BranchMeta[];
      currentIndex: number;
      totalBranches: number;
    }
  | {
      type: 'output-artifacts';
      key: string;
      artifacts: Artifact[];
    }
  | {
      type: 'permission';
      key: string;
      permission: PermissionRequest & {
        resolved?: boolean;
        decision?: 'allow' | 'deny' | 'always_allow';
      };
      /** Display name of the sub-agent that asked, when one is known. */
      ownerName?: string;
    };

/**
 * Is this assistant message a self-contained answer rather than a step along
 * the way? Answers carry prose and no tool calls; anything that invokes a
 * tool is still working. A sub-agent's prose is its report to the main agent,
 * never the answer to the user, so it always stays inside the activity group.
 */
function isFinalAnswer(msg: AGUIMessage): boolean {
  return (
    msg.role === 'assistant' &&
    !msg.subagentRunId &&
    !!msg.content?.trim() &&
    !msg.toolCalls?.length &&
    !msg.isError &&
    !isPlanJson(msg.content)
  );
}

/**
 * Pure function that converts a flat message array into grouped items.
 * Used by Virtuoso for virtualized rendering.
 *
 * Shape of the output: every agent turn collapses to at most one `activity`
 * item (all intermediate narration + tool calls, collapsed by default)
 * followed by the turn's actual answer as full-weight message bubbles. A
 * 90-message turn therefore reads as one summary line and one answer instead
 * of forty stacked blocks. Interactive and failed items — AskUserQuestion
 * cards, error bubbles — are hoisted out of the group so they stay visible,
 * splitting the group around them.
 */
export function groupMessages(
  messages: AGUIMessage[],
  pendingPlan: TaskPlan | null,
  isWaitingApproval: boolean,
): GroupedItem[] {
  const items: GroupedItem[] = [];
  let planInserted = false;
  let i = 0;
  // Set right after an AskUserQuestion card; consumed by the very next user
  // message. AskUserQuestionCard already renders that answer inline as its
  // "answered" state, so the plain user bubble here would just duplicate it.
  let awaitingQuestionAnswer = false;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'user') {
      const skip = awaitingQuestionAnswer;
      awaitingQuestionAnswer = false;
      if (skip) {
        i++;
        continue;
      }
      items.push({ type: 'message', key: msg.id, msg });
      // Plan card belongs directly under the first user message.
      if (!planInserted && pendingPlan) {
        items.push({
          type: 'plan-approval',
          key: 'plan-card',
          plan: pendingPlan,
          isWaitingApproval,
        });
        planInserted = true;
      }
      i++;
      continue;
    }

    // Collect the whole agent turn — everything up to the next user message.
    let end = i;
    while (end < messages.length && messages[end].role !== 'user') end++;
    const rawTurn = messages.slice(i, end);
    i = end;

    // Activity messages are widgets, not conversation: lift them out so they
    // never sit in the work list or stop the answer from being peeled off the
    // back. Only a live planning phase is shown; a settled one is history.
    const turn: AGUIMessage[] = [];
    const downloadCalls = new Set<string>();
    for (const m of rawTurn) {
      if (m.role !== 'activity') {
        turn.push(m);
        continue;
      }
      if (m.activityType === MEDIA_DOWNLOAD_ACTIVITY) {
        const activity = downloadActivitySchema.safeParse(m.content);
        if (activity.success) {
          downloadCalls.add(activity.data.toolCallId);
          items.push({
            type: 'download-widget',
            key: m.id,
            activity: activity.data,
          });
        }
        continue;
      }
      const status = readStatusActivity(m);
      if (status?.phase === 'planning') {
        items.push({ type: 'status-widget', key: m.id, status });
        continue;
      }
      const plan = readPlanActivity(m);
      if (plan) items.push({ type: 'plan-widget', key: m.id, plan });
    }

    // Peel the trailing answer off the back of the turn. Consecutive
    // content-only assistant messages at the end are all part of it (the
    // agent's closing prose plus any dispatch summary).
    let split = turn.length;
    while (split > 0 && isFinalAnswer(turn[split - 1])) split--;
    const work = turn.slice(0, split);
    const answer = turn.slice(split);

    let entries: ActivityEntry[] = [];
    const flush = () => {
      if (entries.length === 0) return;
      const first = entries[0];
      const key = first.kind === 'note' ? `n-${first.id}` : `t-${first.tc.id}`;
      items.push({ type: 'activity', key: `act-${key}`, entries });
      entries = [];
    };

    for (const m of work) {
      // Tool results are consumed by the tool lines; reasoning blocks are
      // the model's scratchpad and never surface in the thread.
      if (m.role !== 'assistant') continue;

      // Errors must not hide inside a collapsed group.
      if (m.isError) {
        flush();
        items.push({ type: 'message', key: m.id, msg: m });
        continue;
      }

      const content = m.content?.trim();
      const owner = m.subagentRunId
        ? { subagentRunId: m.subagentRunId }
        : undefined;
      if (content && !isPlanJson(content)) {
        entries.push({ kind: 'note', id: m.id, text: content, ...owner });
      }

      for (const tc of m.toolCalls ?? []) {
        if (
          downloadCalls.has(tc.id) &&
          shortToolName(getToolName(tc)) === DOWNLOAD_MEDIA_TOOL
        )
          continue;
        // AskUserQuestion renders an interactive card — it can't be buried.
        if (getToolName(tc) === 'AskUserQuestion') {
          flush();
          items.push({
            type: 'tool-group',
            key: `tg-${tc.id}`,
            toolCalls: [tc],
          });
          awaitingQuestionAnswer = true;
          continue;
        }
        entries.push({ kind: 'tool', tc, ...owner });
      }
    }
    flush();

    for (const m of answer) {
      items.push({ type: 'message', key: m.id, msg: m });
    }
  }

  return items;
}
