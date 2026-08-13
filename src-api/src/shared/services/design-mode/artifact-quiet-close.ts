import { EventType, type BaseEvent } from '@ag-ui/core';

import { getSetting } from '@/shared/db/operations';
import { CustomEventName } from '@/shared/services/ag-ui/event-schema';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DesignArtifacts');

export const DEFAULT_LIVE_ARTIFACT_QUIET_MS = 20_000;
const MIN_LIVE_ARTIFACT_QUIET_MS = 1_000;
const MAX_LIVE_ARTIFACT_QUIET_MS = 120_000;

export interface LiveArtifactQuietCloseEvent {
  taskId: string;
  runId: string;
  quietMs: number;
  quietClose: true;
}

interface RegisteredRunOptions {
  taskId: string;
  runId: string;
  quietMs?: number;
}

class LiveArtifactQuietCloseRun {
  private deliverableRegistered = false;
  private finished = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly quietClosePromise: Promise<LiveArtifactQuietCloseEvent>;
  private resolveQuietClose!: (event: LiveArtifactQuietCloseEvent) => void;

  readonly quietMs: number;

  constructor(
    readonly taskId: string,
    readonly runId: string,
    quietMs?: number,
  ) {
    this.quietMs = normalizeQuietMs(quietMs);
    this.quietClosePromise = new Promise((resolve) => {
      this.resolveQuietClose = resolve;
    });
  }

  waitForQuietClose(): Promise<LiveArtifactQuietCloseEvent> {
    return this.quietClosePromise;
  }

  registerDeliverable(): void {
    if (this.finished) return;
    this.deliverableRegistered = true;
    this.schedule();
  }

  touchOutput(): void {
    if (!this.deliverableRegistered || this.finished) return;
    this.schedule();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimer();
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.close(), this.quietMs);
    this.timer.unref?.();
  }

  private close(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimer();
    const event: LiveArtifactQuietCloseEvent = {
      taskId: this.taskId,
      runId: this.runId,
      quietMs: this.quietMs,
      quietClose: true,
    };
    logger.info('artifact_quiet_close', {
      taskId: this.taskId,
      runId: this.runId,
      quietMs: this.quietMs,
    });
    this.resolveQuietClose(event);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

class LiveArtifactQuietCloseRegistry {
  private readonly runsByKey = new Map<string, LiveArtifactQuietCloseRun>();
  private readonly latestRunKeyByTask = new Map<string, string>();

  registerRun(options: RegisteredRunOptions): LiveArtifactQuietCloseRun {
    const key = this.key(options.taskId, options.runId);
    const existing = this.runsByKey.get(key);
    if (existing) return existing;
    const run = new LiveArtifactQuietCloseRun(
      options.taskId,
      options.runId,
      options.quietMs,
    );
    this.runsByKey.set(key, run);
    this.latestRunKeyByTask.set(options.taskId, key);
    return run;
  }

  registerDeliverable(taskId: string, runId?: string): void {
    this.find(taskId, runId)?.registerDeliverable();
  }

  touchOutput(taskId: string, runId?: string): void {
    this.find(taskId, runId)?.touchOutput();
  }

  finishRun(taskId: string, runId?: string): void {
    const key = runId
      ? this.key(taskId, runId)
      : this.latestRunKeyByTask.get(taskId);
    if (!key) return;
    const run = this.runsByKey.get(key);
    run?.finish();
    this.runsByKey.delete(key);
    if (this.latestRunKeyByTask.get(taskId) === key) {
      this.latestRunKeyByTask.delete(taskId);
    }
  }

  resetForTests(): void {
    for (const run of this.runsByKey.values()) {
      run.finish();
    }
    this.runsByKey.clear();
    this.latestRunKeyByTask.clear();
  }

  private find(
    taskId: string,
    runId?: string,
  ): LiveArtifactQuietCloseRun | undefined {
    const key = runId
      ? this.key(taskId, runId)
      : this.latestRunKeyByTask.get(taskId);
    return key ? this.runsByKey.get(key) : undefined;
  }

  private key(taskId: string, runId: string): string {
    return `${taskId}:${runId}`;
  }
}

export const liveArtifactQuietCloseRegistry =
  new LiveArtifactQuietCloseRegistry();

export function normalizeQuietMs(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_LIVE_ARTIFACT_QUIET_MS;
  return Math.min(
    MAX_LIVE_ARTIFACT_QUIET_MS,
    Math.max(MIN_LIVE_ARTIFACT_QUIET_MS, Math.trunc(parsed)),
  );
}

export function readLiveArtifactQuietMs(value?: unknown): number {
  if (value !== undefined) return normalizeQuietMs(value);
  return normalizeQuietMs(getSetting('designModeLiveArtifactQuietMs'));
}

function customEventName(event: BaseEvent): string | undefined {
  return (event as BaseEvent & { name?: string }).name;
}

function customEventRunId(event: BaseEvent): string | undefined {
  const value = (event as BaseEvent & { value?: unknown }).value;
  if (!value || typeof value !== 'object') return undefined;
  const runId = (value as { runId?: unknown }).runId;
  return typeof runId === 'string' ? runId : undefined;
}

function isLiveArtifactDeliverableEvent(event: BaseEvent): boolean {
  return (
    event.type === EventType.CUSTOM &&
    customEventName(event) === CustomEventName.ArtifactUpdate
  );
}

function isFileStateDelta(event: BaseEvent): boolean {
  if (event.type !== EventType.STATE_DELTA) return false;
  const delta = (event as BaseEvent & { delta?: unknown }).delta;
  return (
    Array.isArray(delta) &&
    delta.some(
      (patch) =>
        patch &&
        typeof patch === 'object' &&
        typeof (patch as { path?: unknown }).path === 'string' &&
        (patch as { path: string }).path.startsWith('/files'),
    )
  );
}

function isChatVisibleOutput(event: BaseEvent): boolean {
  switch (event.type) {
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.TEXT_MESSAGE_CHUNK:
    case EventType.TOOL_CALL_RESULT:
      return true;
    case EventType.STATE_DELTA:
      return isFileStateDelta(event);
    default:
      return false;
  }
}

function isTerminalEvent(event: BaseEvent): boolean {
  return (
    event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR
  );
}

export interface DesignLiveArtifactQuietCloseOptions {
  enabled: boolean;
  taskId: string;
  runId: string;
  threadId: string;
  quietMs?: number;
}

export async function* withDesignLiveArtifactQuietClose(
  events: AsyncGenerator<BaseEvent>,
  options: DesignLiveArtifactQuietCloseOptions,
): AsyncGenerator<BaseEvent> {
  if (!options.enabled) {
    yield* events;
    return;
  }

  const run = liveArtifactQuietCloseRegistry.registerRun({
    taskId: options.taskId,
    runId: options.runId,
    quietMs: options.quietMs,
  });

  try {
    while (true) {
      const nextEvent = events.next();
      const winner = await Promise.race([
        nextEvent.then((result) => ({ type: 'event' as const, result })),
        run
          .waitForQuietClose()
          .then((event) => ({ type: 'quiet-close' as const, event })),
      ]);

      if (winner.type === 'quiet-close') {
        void events.return?.(undefined).catch(() => {});
        yield {
          type: EventType.RUN_FINISHED,
          threadId: options.threadId,
          runId: options.runId,
          timestamp: Date.now(),
          quietClose: true,
        } as BaseEvent;
        return;
      }

      if (winner.result.done) return;
      const event = winner.result.value;
      if (isLiveArtifactDeliverableEvent(event)) {
        liveArtifactQuietCloseRegistry.registerDeliverable(
          options.taskId,
          customEventRunId(event) ?? options.runId,
        );
      }
      if (isChatVisibleOutput(event)) {
        liveArtifactQuietCloseRegistry.touchOutput(
          options.taskId,
          options.runId,
        );
      }
      yield event;

      if (isTerminalEvent(event)) return;
    }
  } finally {
    liveArtifactQuietCloseRegistry.finishRun(options.taskId, options.runId);
  }
}
