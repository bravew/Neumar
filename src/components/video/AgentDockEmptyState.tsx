import { recordCreativeDebugCounter } from '@/shared/creative-workflow/debug-counters';
import type { VideoPluginSummary } from '@/shared/hooks/useVideoPlugins';

import { AgentPluginPicker } from './AgentPluginPicker';
import type { AgentPluginPickerLabels } from './AgentPluginPicker';
import { AgentRecipePicker } from './AgentRecipePicker';
import type { AgentRecipePickerLabels } from './AgentRecipePicker';

interface AgentDockEmptyStateProps {
  pluginLabels: AgentPluginPickerLabels;
  recipeLabels: AgentRecipePickerLabels;
  suggestions: string[];
  disabled: boolean;
  onSelectPlugin: (plugin: VideoPluginSummary) => void;
  onSelectPrompt: (prompt: string) => void;
}

export function AgentDockEmptyState({
  pluginLabels,
  recipeLabels,
  suggestions,
  disabled,
  onSelectPlugin,
  onSelectPrompt,
}: AgentDockEmptyStateProps) {
  const selectPrompt = (prompt: string) => {
    recordCreativeDebugCounter('agent.suggestion.selected');
    onSelectPrompt(prompt);
  };

  return (
    <div className="space-y-2">
      <AgentPluginPicker
        labels={pluginLabels}
        disabled={disabled}
        onSelect={onSelectPlugin}
      />
      <AgentRecipePicker
        labels={recipeLabels}
        disabled={disabled}
        onSelect={selectPrompt}
      />
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          disabled={disabled}
          onClick={() => selectPrompt(suggestion)}
          className="border-border hover:bg-accent block w-full rounded-md border px-3 py-2 text-left text-xs disabled:opacity-50"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}
