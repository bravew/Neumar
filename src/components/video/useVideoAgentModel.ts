import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_MODEL_ID,
  type ModelOption,
} from '@/components/shared/ChatInput.types';
import { useModelOptions } from '@/components/shared/useModelOptions';

/**
 * LLM model selection for the Video Mode agent dock. The video agent routes by
 * the selected model's provider: Claude models use the in-process Claude
 * adapter; `codex:` models run on the Codex CLI with the same video tool
 * surface exposed over the loopback MCP bridge (see the video agent's
 * `bridgeInProcessServers`). Only providers with a proven video tool bridge
 * are offered. Server-declared runtime capabilities are the authority for
 * Video support; runtimes gain Video only after declaring a proven bridge. The choice is
 * persisted per project and threaded into the agent run request body.
 */
export interface VideoAgentModel {
  modelOptions: ModelOption[];
  modelId: string;
  setModelId: (modelId: string) => void;
}

const STORAGE_PREFIX = 'video.agentDock.model.';

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function readStoredModel(projectId: string): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID;
  return (
    window.localStorage?.getItem(storageKey(projectId)) ?? DEFAULT_MODEL_ID
  );
}

function fallbackVideoModel(modelOptions: readonly ModelOption[]): string {
  return (
    modelOptions.find((option) => !option.disabled)?.id ?? DEFAULT_MODEL_ID
  );
}

export function resolveSelectableVideoModel(
  modelId: string,
  modelOptions: readonly ModelOption[],
): string {
  const option = modelOptions.find((candidate) => candidate.id === modelId);
  if (!option || option.disabled) return fallbackVideoModel(modelOptions);

  return modelId;
}

export function useVideoAgentModel(projectId: string): VideoAgentModel {
  const modelOptions = useModelOptions('video');
  const [modelId, setModelIdState] = useState<string>(() =>
    readStoredModel(projectId),
  );

  // Re-read the stored choice when switching projects, and self-heal stale
  // persisted runtime ids that are no longer selectable in Video Mode. Without
  // this, a legacy `qwen:*` / `copilot:*` value falls through the video backend
  // to Claude and is sent as an invalid Claude model id.
  //
  // An empty option list means runtime detection has not answered yet (video
  // rows require server-declared capabilities). Healing against it would
  // overwrite the persisted choice with the default before the real catalog
  // arrives, so hold the stored value until there is something to check.
  useEffect(() => {
    const stored = readStoredModel(projectId);
    if (modelOptions.length === 0) {
      setModelIdState(stored);
      return;
    }
    const next = resolveSelectableVideoModel(stored, modelOptions);
    setModelIdState(next);
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(storageKey(projectId), next);
    }
  }, [projectId, modelOptions]);

  const setModelId = useCallback(
    (next: string) => {
      const selectable = resolveSelectableVideoModel(next, modelOptions);
      setModelIdState(selectable);
      if (typeof window !== 'undefined') {
        window.localStorage?.setItem(storageKey(projectId), selectable);
      }
    },
    [modelOptions, projectId],
  );

  return { modelOptions, modelId, setModelId };
}
