import { toast } from 'sonner';

import { sendOsNotification } from './desktop';
import { getNotificationPreferences } from './preferences';
import { playSound } from './sound';

export type AgentNotificationKind =
  | 'progress'
  | 'error'
  | 'succeeded'
  | 'failed';

export type AgentNotificationSource =
  | 'agent-stream'
  | 'automation-sse'
  | 'updater'
  | 'manual';

export interface AgentNotificationEvent {
  runId: string;
  kind: AgentNotificationKind;
  title: string;
  body?: string;
  link?: string;
  source: AgentNotificationSource;
  timestamp?: number;
}

export interface NotifyAgentEventOptions {
  showToast?: boolean;
  requestPermission?: boolean;
}

const PROGRESS_THROTTLE_MS = 800;
const MAX_DEDUPE_ENTRIES = 500;
const MAX_PROGRESS_ENTRIES = 500;
const terminalDedupeKeys = new Set<string>();
const progressThrottle = new Map<string, number>();
const listeners = new Set<(event: AgentNotificationEvent) => void>();

/**
 * Task thread the user is actively viewing (route `/task-v2/:taskId`), or null.
 * Set by the task detail page on mount and cleared on unmount.
 *
 * A "completed" toast for this task is redundant — the open thread already
 * reflects completion inline — so we suppress just the toast (focus-aware
 * notification UX). Sound, OS notification, and subscribers are untouched, and
 * failures still toast: an error warrants attention even while the thread is open.
 */
let activeTaskThreadId: string | null = null;

export function setActiveTaskThread(taskId: string | null): void {
  activeTaskThreadId = taskId;
}

export function getActiveTaskThread(): string | null {
  return activeTaskThreadId;
}

function recordTerminalKey(key: string): void {
  if (terminalDedupeKeys.size >= MAX_DEDUPE_ENTRIES) {
    const oldest = terminalDedupeKeys.values().next().value;
    if (oldest !== undefined) terminalDedupeKeys.delete(oldest);
  }
  terminalDedupeKeys.add(key);
}

function recordProgress(runId: string, timestamp: number): void {
  if (progressThrottle.has(runId)) {
    progressThrottle.delete(runId);
  } else if (progressThrottle.size >= MAX_PROGRESS_ENTRIES) {
    const oldest = progressThrottle.keys().next().value;
    if (oldest !== undefined) progressThrottle.delete(oldest);
  }
  progressThrottle.set(runId, timestamp);
}

export function agentDedupeKey(
  event: Pick<AgentNotificationEvent, 'runId' | 'kind'>,
): string {
  return `${event.runId}:${event.kind}`;
}

function isTerminalKind(kind: AgentNotificationKind): boolean {
  return kind === 'succeeded' || kind === 'failed' || kind === 'error';
}

function truncateBody(body: string | undefined, maxLength: number): string {
  if (!body) return '';
  const normalized = body.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function showAgentToast(event: AgentNotificationEvent): void {
  const description = truncateBody(event.body, 160);

  if (event.kind === 'progress') {
    toast(event.title, {
      id: `agent-progress:${event.runId}`,
      description,
      duration: 2500,
    });
    return;
  }

  const toastOptions = {
    id: `agent-${event.kind}:${event.runId}`,
    description,
    duration: event.kind === 'succeeded' ? 4000 : Infinity,
  };

  if (event.kind === 'succeeded') {
    toast.success(event.title, toastOptions);
  } else {
    toast.error(event.title, toastOptions);
  }
}

function notifySubscribers(event: AgentNotificationEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A notification subscriber must not block the shared side effects.
    }
  }
}

export async function notifyAgentEvent(
  event: AgentNotificationEvent,
  options: NotifyAgentEventOptions = {},
): Promise<boolean> {
  if (!event.runId) return false;

  const key = agentDedupeKey(event);
  const now = event.timestamp ?? Date.now();
  const terminal = isTerminalKind(event.kind);

  if (terminal) {
    if (terminalDedupeKeys.has(key)) return false;
    recordTerminalKey(key);
  } else {
    const lastProgressAt = progressThrottle.get(event.runId) ?? 0;
    if (now - lastProgressAt < PROGRESS_THROTTLE_MS) return false;
    recordProgress(event.runId, now);
  }

  // Suppress the redundant "completed" toast while the user is viewing this
  // task's thread — completion is already visible there. Failures still toast.
  const viewingThisThread =
    event.kind === 'succeeded' && event.runId === activeTaskThreadId;
  const showToast = (options.showToast ?? true) && !viewingThisThread;
  if (showToast) {
    showAgentToast(event);
  }

  if (terminal) {
    const prefs = getNotificationPreferences();
    if (prefs.soundEnabled) {
      playSound(
        event.kind === 'succeeded'
          ? prefs.successSoundId
          : prefs.failureSoundId,
      );
    }

    await sendOsNotification(
      {
        runId: event.runId,
        kind: event.kind,
        title: event.title,
        body: truncateBody(event.body, 80),
        link: event.link,
        data: { source: event.source },
      },
      { request: options.requestPermission ?? false },
    );
  }

  notifySubscribers(event);
  return true;
}

export function subscribeAgentNotifications(
  listener: (event: AgentNotificationEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetAgentNotificationStateForTests(): void {
  terminalDedupeKeys.clear();
  progressThrottle.clear();
  listeners.clear();
  activeTaskThreadId = null;
}
