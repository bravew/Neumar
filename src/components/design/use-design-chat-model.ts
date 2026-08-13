import { useCallback, useState } from 'react';

import {
  DEFAULT_MODEL_ID,
  type ModelOption,
} from '@/components/shared/ChatInput.types';
import { useModelOptions } from '@/components/shared/useModelOptions';
import { parseRuntimeModelId } from '@/shared/lib/runtime-model-ids';

/**
 * Design-chat model selection, consolidated onto the shared mode-scoped
 * catalog (`useModelOptions('design')`: configured providers + detected local
 * CLI runtimes). Exposes the same `ModelOption[]` shape the task-mode picker
 * uses, and resolves the selected model back to the `{ provider, model }`
 * pair the design chat API expects — the model's provider is the coding agent
 * that runs the conversation. Structured runtime ids (`cursor-agent:auto`)
 * are unprefixed here, at the API boundary; `codex:` ids keep their
 * established contract (the Codex adapter strips the prefix backend-side).
 */
export function useDesignChatModel(): {
  modelOptions: ModelOption[];
  modelId: string;
  setModelId: (id: string) => void;
  sendModel: () => { provider: string; model: string };
} {
  const modelOptions = useModelOptions('design');
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID);
  const sendModel = useCallback(() => {
    const parsed = parseRuntimeModelId(modelId);
    if (parsed) return { provider: parsed.runtimeId, model: parsed.model };
    const option = modelOptions.find((m) => m.id === modelId);
    return { provider: option?.provider ?? 'claude', model: modelId };
  }, [modelOptions, modelId]);

  return { modelOptions, modelId, setModelId, sendModel };
}
