import { ChevronDown, Zap } from 'lucide-react';

import type { ModelRoutingConfig, TaskType } from '@/shared/db/settings';
import {
  isAgentCapableModel,
  isProviderReady,
  TASK_TYPE_RECOMMENDED_TIER,
} from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { AIProvider } from '../types';

// ============================================================================
// Constants
// ============================================================================

/** All task types in display order */
const ALL_TASK_TYPES: TaskType[] = [
  'planning',
  'execution',
  'titleGeneration',
  'research',
  'codeReview',
];

/** Build type-safe i18n label/description maps from locale object */
function getTaskLabels(settings: {
  taskPlanning: string;
  taskExecution: string;
  taskTitleGeneration: string;
  taskResearch: string;
  taskCodeReview: string;
}): Record<TaskType, string> {
  return {
    planning: settings.taskPlanning,
    execution: settings.taskExecution,
    titleGeneration: settings.taskTitleGeneration,
    research: settings.taskResearch,
    codeReview: settings.taskCodeReview,
  };
}

function getTaskDescs(settings: {
  taskPlanningDesc: string;
  taskExecutionDesc: string;
  taskTitleGenerationDesc: string;
  taskResearchDesc: string;
  taskCodeReviewDesc: string;
}): Record<TaskType, string> {
  return {
    planning: settings.taskPlanningDesc,
    execution: settings.taskExecutionDesc,
    titleGeneration: settings.taskTitleGenerationDesc,
    research: settings.taskResearchDesc,
    codeReview: settings.taskCodeReviewDesc,
  };
}

/** Tier badge colors */
const TIER_COLORS: Record<string, string> = {
  frontier:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  balanced: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  fast: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

function getTierLabel(
  tier: string,
  labels: {
    modelRoutingFrontier: string;
    modelRoutingBalanced: string;
    modelRoutingFast: string;
  },
): string {
  switch (tier) {
    case 'frontier':
      return labels.modelRoutingFrontier;
    case 'balanced':
      return labels.modelRoutingBalanced;
    default:
      return labels.modelRoutingFast;
  }
}

// ============================================================================
// Types
// ============================================================================

interface ModelRoutingSectionProps {
  providers: AIProvider[];
  modelRouting: ModelRoutingConfig;
  onRoutingChange: (
    taskType: TaskType,
    field: 'provider' | 'model',
    value: string,
  ) => void;
}

// ============================================================================
// Component
// ============================================================================

export function ModelRoutingSection({
  providers,
  modelRouting,
  onRoutingChange,
}: ModelRoutingSectionProps) {
  const { t } = useLanguage();
  const taskLabels = getTaskLabels(t.settings);
  const taskDescs = getTaskDescs(t.settings);

  // Pre-filter configured providers once (not per task type)
  const configuredProviders = providers.filter(
    (p) => p.enabled && isProviderReady(p),
  );

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-foreground flex items-center gap-2 text-sm font-medium">
          <Zap className="size-4" />
          {t.settings.modelRouting}
        </h4>
        <p className="text-muted-foreground mt-1 text-xs">
          {t.settings.modelRoutingDescription}
        </p>
      </div>

      <div className="space-y-3">
        {ALL_TASK_TYPES.map((taskType) => {
          const currentRoute = modelRouting?.[taskType] || {
            provider: 'default',
            model: '',
          };
          const isDefault =
            !currentRoute.provider || currentRoute.provider === 'default';
          const selectedRoutingProvider = providers.find(
            (p) => p.id === currentRoute.provider,
          );
          const tier = TASK_TYPE_RECOMMENDED_TIER[taskType];
          const tierLabel = getTierLabel(tier, t.settings);
          const taskLabel = taskLabels[taskType] ?? taskType;
          const taskDesc = taskDescs[taskType] ?? '';

          return (
            <div key={taskType} className="border-border rounded-lg border p-3">
              {/* Task type header */}
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-foreground text-sm font-medium">
                    {taskLabel}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      TIER_COLORS[tier],
                    )}
                  >
                    {tierLabel}
                  </span>
                </div>
                {!isDefault && (
                  <button
                    onClick={() =>
                      onRoutingChange(taskType, 'provider', 'default')
                    }
                    className="text-muted-foreground hover:text-foreground text-xs"
                    aria-label={`${t.settings.reset} ${taskLabel}`}
                  >
                    {t.settings.reset}
                  </button>
                )}
              </div>

              <p className="text-muted-foreground mb-2 text-xs">{taskDesc}</p>

              {/* Provider + Model selectors */}
              <div className="flex gap-2">
                {/* Provider selector */}
                <div className="relative min-w-0 flex-1">
                  <select
                    value={currentRoute.provider || 'default'}
                    onChange={(e) =>
                      onRoutingChange(taskType, 'provider', e.target.value)
                    }
                    className="border-input bg-background text-foreground focus:ring-ring h-8 w-full appearance-none rounded-md border pr-7 pl-2 text-xs focus:ring-1 focus:outline-none"
                    aria-label={`${taskLabel} provider`}
                  >
                    <option value="default">
                      {t.settings.modelRoutingDefault}
                    </option>
                    {configuredProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2" />
                </div>

                {/* Model selector (only when non-default provider) — filtered to agent-capable models */}
                {!isDefault && selectedRoutingProvider && (
                  <div className="relative min-w-0 flex-1">
                    <select
                      value={currentRoute.model || ''}
                      onChange={(e) =>
                        onRoutingChange(taskType, 'model', e.target.value)
                      }
                      className="border-input bg-background text-foreground focus:ring-ring h-8 w-full appearance-none rounded-md border pr-7 pl-2 text-xs focus:ring-1 focus:outline-none"
                      aria-label={`${taskLabel} model`}
                    >
                      {selectedRoutingProvider.models
                        .filter((m) => isAgentCapableModel(m))
                        .map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                    </select>
                    <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
