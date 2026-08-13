import { useRef } from 'react';

import {
  getModelShortLabel,
  type ModelOption,
} from '@/components/shared/ChatInput.types';
import { ModelSelector } from '@/components/shared/ChatInputModelSelector';
import type { DesignProject } from '@/shared/types/design-mode';

import { ProjectDesignSystemSwitcher } from './ProjectDesignSystemSwitcher';

/**
 * Inline composer controls for the DesignMode chat loop (Fix-sync Phase 04):
 * a design-system pill + the shared task-mode model picker so the user picks
 * the design system and the model/agent inline. Consolidated onto the same
 * {@link ModelSelector} + `buildModelOptions` source the task composer uses, so
 * it covers every configured provider and model (Claude, Codex, and BYOK
 * providers) instead of a hardcoded Claude/Codex pair. The selected model's
 * provider drives which coding agent runs the chat.
 */
export function DesignComposerControls({
  modelId,
  modelOptions,
  onModelChange,
  project,
  onProjectChange,
}: {
  modelId: string;
  modelOptions: ModelOption[];
  onModelChange: (modelId: string) => void;
  /** Project + change handler for the inline design-system pill (optional). */
  project?: DesignProject;
  onProjectChange?: (project: DesignProject) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeModelLabel =
    modelOptions.find((m) => m.id === modelId)?.label ??
    getModelShortLabel(modelId);

  return (
    <div className="flex min-w-0 items-center gap-2">
      {project && onProjectChange && (
        <ProjectDesignSystemSwitcher
          project={project}
          onProjectChange={onProjectChange}
        />
      )}
      <ModelSelector
        modelOptions={modelOptions}
        activeModelId={modelId}
        activeModelLabel={activeModelLabel}
        onModelChange={onModelChange}
        isRunning={false}
        disabled={false}
        isHome
        triggerRef={triggerRef}
      />
    </div>
  );
}
