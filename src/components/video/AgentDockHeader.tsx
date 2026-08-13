import { useRef } from 'react';

import { Bot, Square, Trash2, X } from 'lucide-react';

import { ChatPanel } from '@/components/shared/chat-panel';
import { getModelShortLabel } from '@/components/shared/ChatInput.types';
import { ModelSelector } from '@/components/shared/ChatInputModelSelector';
import { useLanguage } from '@/shared/providers/language-provider';

import type { VideoAgentModel } from './useVideoAgentModel';

interface AgentDockHeaderProps {
  title: string;
  sceneLabel: string;
  aspectRatio: string;
  stopLabel: string;
  clearLabel: string;
  closeLabel: string;
  model: VideoAgentModel;
  streaming: boolean;
  onCancelStream: () => void;
  onClearHistory: () => void;
  onClose: () => void;
}

export function AgentDockHeader({
  title,
  sceneLabel,
  aspectRatio,
  stopLabel,
  clearLabel,
  closeLabel,
  model,
  streaming,
  onCancelStream,
  onClearHistory,
  onClose,
}: AgentDockHeaderProps) {
  const { t } = useLanguage();
  const aspectLabel = t.video.editor.agentDock.context.aspect.replace(
    '{aspect}',
    aspectRatio,
  );
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeModelLabel =
    model.modelOptions.find((option) => option.id === model.modelId)?.label ??
    getModelShortLabel(model.modelId);
  return (
    <ChatPanel.Header
      actions={
        <>
          {streaming ? (
            <button
              type="button"
              onClick={onCancelStream}
              className="hover:bg-accent rounded-md p-1.5"
              aria-label={stopLabel}
            >
              <Square className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClearHistory}
            className="hover:bg-accent rounded-md p-1.5"
            aria-label={clearLabel}
          >
            <Trash2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-accent rounded-md p-1.5"
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </button>
        </>
      }
    >
      <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <Bot className="size-4" />
        {title}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
          {sceneLabel}
        </span>
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]">
          {aspectLabel}
        </span>
        <ModelSelector
          modelOptions={model.modelOptions}
          activeModelId={model.modelId}
          activeModelLabel={activeModelLabel}
          onModelChange={model.setModelId}
          isRunning={streaming}
          disabled={false}
          isHome
          triggerRef={modelTriggerRef}
        />
      </div>
    </ChatPanel.Header>
  );
}
