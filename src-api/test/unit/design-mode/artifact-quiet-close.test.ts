import { EventType, type BaseEvent } from '@ag-ui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomEventName } from '@/shared/services/ag-ui/event-schema';
import {
  liveArtifactQuietCloseRegistry,
  withDesignLiveArtifactQuietClose,
} from '@/shared/services/design-mode/artifact-quiet-close';

const taskId = 'task-live-artifact';
const runId = 'run-live-artifact';

function artifactUpdate(): BaseEvent {
  return {
    type: EventType.CUSTOM,
    name: CustomEventName.ArtifactUpdate,
    value: {
      runId,
      artifactId: 'artifact-1',
      mime: 'text/html',
      uri: 'file://artifact.html',
      parentArtifactId: null,
      delta: false,
    },
  } as BaseEvent;
}

function textOutput(): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: 'assistant-1',
    delta: 'More visible output',
  } as BaseEvent;
}

function never(): Promise<never> {
  return new Promise(() => {});
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function quietWrapped(events: AsyncGenerator<BaseEvent>) {
  return withDesignLiveArtifactQuietClose(events, {
    enabled: true,
    taskId,
    runId,
    threadId: taskId,
    quietMs: 1_000,
  });
}

describe('DesignMode live-artifact quiet close', () => {
  afterEach(() => {
    liveArtifactQuietCloseRegistry.resetForTests();
    vi.useRealTimers();
  });

  it('closes after the quiet period once a deliverable is registered', async () => {
    vi.useFakeTimers();
    async function* source() {
      yield artifactUpdate();
      await never();
    }

    const iterator = quietWrapped(source());
    expect((await iterator.next()).value).toMatchObject({
      type: EventType.CUSTOM,
      name: CustomEventName.ArtifactUpdate,
    });

    const close = iterator.next();
    let settled = false;
    close.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect((await close).value).toMatchObject({
      type: EventType.RUN_FINISHED,
      runId,
      quietClose: true,
    });
  });

  it('resets the quiet timer when new chat-visible output arrives', async () => {
    vi.useFakeTimers();
    const releaseText = deferred();
    async function* source() {
      yield artifactUpdate();
      await releaseText.promise;
      yield textOutput();
      await never();
    }

    const iterator = quietWrapped(source());
    await iterator.next();

    await vi.advanceTimersByTimeAsync(900);
    const text = iterator.next();
    releaseText.resolve();
    expect((await text).value).toMatchObject({
      type: EventType.TEXT_MESSAGE_CONTENT,
    });

    const close = iterator.next();
    let settled = false;
    close.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await close).value).toMatchObject({
      type: EventType.RUN_FINISHED,
      quietClose: true,
    });
  });

  it('leaves ordinary runs unaffected', async () => {
    vi.useFakeTimers();
    async function* source() {
      yield artifactUpdate();
    }

    const events: BaseEvent[] = [];
    for await (const event of withDesignLiveArtifactQuietClose(source(), {
      enabled: false,
      taskId,
      runId,
      threadId: taskId,
      quietMs: 1_000,
    })) {
      events.push(event);
    }
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(EventType.CUSTOM);
    expect(events.some((event) => event.type === EventType.RUN_FINISHED)).toBe(
      false,
    );
  });
});
