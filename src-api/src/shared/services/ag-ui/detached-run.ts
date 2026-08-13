import type { BaseEvent } from '@ag-ui/core';

import type { RunMode } from '@/core/agent/runtime-state';

import type { AGUIEventPersister } from './persistence';
import type { ReattachRunContext } from './reattach';
import { registerActiveAGUIRun } from './runtime';
import { runDetachedPipeline } from './transport';

export interface DetachedAGUIRunInput {
  mode: RunMode;
  ownerKey: string;
  runId: string;
  threadId: string;
  busKey: string;
  controller: AbortController;
  events: AsyncGenerator<BaseEvent>;
  persister: AGUIEventPersister;
  reattach?: ReattachRunContext;
  onTerminal?: () => void;
}

export function startDetachedAGUIRun(
  input: DetachedAGUIRunInput,
): Promise<void> {
  const unregister = registerActiveAGUIRun({
    mode: input.mode,
    ownerKey: input.ownerKey,
    runId: input.runId,
    busKey: input.busKey,
    controller: input.controller,
    reattach: input.reattach,
  });
  return runDetachedPipeline(
    input.events,
    input.busKey,
    input.persister,
    () => {
      unregister();
      input.onTerminal?.();
    },
    { threadId: input.threadId, runId: input.runId },
  );
}
