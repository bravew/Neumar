import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  X,
} from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { isAgentCapableModel } from '@/shared/db/settings';
import type { ModelPricing } from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { ModelPricingPanel } from '../components/ModelPricingPanel';
import { Switch } from '../components/Switch';
import type { AIProvider } from '../types';
import { FetchModelsPanel } from './FetchModelsPanel';
import { ModelCapabilityBadges } from './ModelCapabilityBadges';
import { ProviderApiModeNotice } from './ProviderApiModeNotice';
import { ProviderCredentialsFields } from './ProviderCredentialsFields';

// ============================================================================
// Types
// ============================================================================

interface TestResult {
  success: boolean;
  latencyMs: number;
  model: string;
  message: string;
}

interface ProviderDetailViewProps {
  provider: AIProvider;
  allPricing: ModelPricing[];
  expandedModels: Set<string>;
  renamingModel: { index: number; value: string } | null;
  isProviderConfigured: (p: AIProvider) => boolean;
  onProviderUpdate: (providerId: string, updates: Partial<AIProvider>) => void;
  onModelRename: (provider: AIProvider, index: number, newName: string) => void;
  onToggleModelExpand: (provider: AIProvider, modelName: string) => void;
  onRenamingModelChange: (val: { index: number; value: string } | null) => void;
  onPricingUpdated: (updated: ModelPricing) => void;
  onEnsurePricingRecord: (
    modelName: string,
    provider: AIProvider,
  ) => Promise<string>;
  resolvePricingId: (
    modelName: string,
    pricingIds: Record<string, string>,
  ) => string | null;
  syncProviderPricingBillingType: (
    provider: AIProvider,
    billingType: AIProvider['billingType'],
  ) => void;
  getSuggestedModels: (provider: AIProvider) => string[];
}

// ============================================================================
// Component
// ============================================================================

export function ProviderDetailView({
  provider,
  allPricing,
  expandedModels,
  renamingModel,
  isProviderConfigured,
  onProviderUpdate,
  onModelRename,
  onToggleModelExpand,
  onRenamingModelChange,
  onPricingUpdated,
  onEnsurePricingRecord,
  resolvePricingId,
  syncProviderPricingBillingType,
  getSuggestedModels,
}: ProviderDetailViewProps) {
  const { t } = useLanguage();
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const mountedRef = useRef(true);
  const testAbortRef = useRef<AbortController | null>(null);
  const showsApiModeNotice =
    provider.category !== 'local' &&
    (provider.billingType === undefined || provider.billingType === 'api');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      testAbortRef.current?.abort();
    };
  }, []);

  const testProviderModel = useCallback(
    async (p: AIProvider, model: string) => {
      setTestingModel(model);
      setTestResult(null);
      testAbortRef.current?.abort();
      const controller = new AbortController();
      testAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(`${API_BASE_URL}/providers/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: p.apiKey,
            baseUrl: p.baseUrl,
            model,
            agentType: p.agentType,
            providerId: p.id,
            dialect: p.dialect,
          }),
          signal: controller.signal,
        });

        const result = (await response.json()) as TestResult;
        if (mountedRef.current) setTestResult(result);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (mountedRef.current) {
          setTestResult({
            success: false,
            latencyMs: 0,
            model,
            message:
              error instanceof Error
                ? error.message
                : t.settings.connectionFailed,
          });
        }
      } finally {
        clearTimeout(timeoutId);
        if (testAbortRef.current === controller) {
          testAbortRef.current = null;
          if (mountedRef.current) setTestingModel(null);
        }
      }
    },
    [t],
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={provider.name}
            onChange={(e) =>
              onProviderUpdate(provider.id, { name: e.target.value })
            }
            aria-label={t.settings.providerName}
            className="text-foreground hover:border-input focus:border-primary w-40 border-b border-transparent bg-transparent text-base font-medium transition-colors outline-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'size-2 rounded-full',
                isProviderConfigured(provider)
                  ? 'bg-emerald-500'
                  : 'bg-gray-300',
              )}
            />
            <span className="text-muted-foreground text-xs">
              {isProviderConfigured(provider)
                ? t.settings.configured
                : t.settings.notConfigured}
            </span>
          </div>
          <Switch
            checked={provider.enabled}
            onChange={(checked) =>
              onProviderUpdate(provider.id, { enabled: checked })
            }
            disabled={!isProviderConfigured(provider)}
          />
        </div>
      </div>

      <div className="space-y-6">
        {/* Billing Mode */}
        <div className="flex flex-col gap-2">
          <label className="text-foreground block text-sm font-medium">
            {t.settings.modelBillingMode}
          </label>
          <div className="flex gap-2">
            <select
              value={provider.billingType ?? 'api'}
              onChange={(e) => {
                const billingType = e.target.value as AIProvider['billingType'];
                onProviderUpdate(provider.id, { billingType });
                syncProviderPricingBillingType(provider, billingType);
              }}
              className="border-input bg-background text-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
            >
              <option value="api">{t.settings.usagePricingBillingApi}</option>
              <option value="subscription">
                {t.settings.usagePricingBillingSubscription}
              </option>
              <option value="free">{t.settings.usagePricingBillingFree}</option>
            </select>
            {provider.billingType === 'subscription' && (
              <input
                type="text"
                value={provider.billingScope ?? ''}
                onChange={(e) =>
                  onProviderUpdate(provider.id, {
                    billingScope: e.target.value,
                  })
                }
                placeholder={t.settings.modelBillingScopeHint}
                className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
              />
            )}
          </div>
        </div>

        {/* API Key + Base URL with in-field draft validation */}
        <ProviderCredentialsFields
          provider={provider}
          validationModel={
            provider.models.find((m) => m && m !== 'default') ??
            provider.models[0]
          }
          onApiKeyChange={(apiKey) => onProviderUpdate(provider.id, { apiKey })}
          onBaseUrlChange={(baseUrl) =>
            onProviderUpdate(provider.id, { baseUrl })
          }
        />

        {showsApiModeNotice && (
          <ProviderApiModeNotice message={t.settings.byokFileEditToolsNotice} />
        )}
        {provider.dialect === 'kimi-k3' && (
          <ProviderApiModeNotice message={t.settings.kimiK3AlwaysThinking} />
        )}

        {/* Models */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-foreground block text-sm font-medium">
              {t.settings.models}
            </label>
            <button
              onClick={() => setShowAddModel(true)}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs"
            >
              <Plus className="size-3" />
              {t.settings.addModel}
            </button>
          </div>

          {/* Fetch Models Panel */}
          {(provider.baseUrl ||
            provider.agentType === 'claude' ||
            provider.agentType === 'gemini') &&
            (provider.apiKey ||
              provider.category === 'local' ||
              provider.billingType === 'subscription' ||
              provider.billingType === 'free') && (
              <FetchModelsPanel
                provider={provider}
                onModelsChange={(models) =>
                  onProviderUpdate(provider.id, { models })
                }
              />
            )}

          {/* Model List */}
          <div className="space-y-2">
            {(provider.models || []).map((model, index) => {
              const isTesting = testingModel === model;
              const hasResult = testResult && testResult.model === model;
              const isAgent = isAgentCapableModel(model);
              const expandKey = `${provider.id}:${model}`;
              const isExpanded = expandedModels.has(expandKey);
              const isRenaming = renamingModel?.index === index;
              const pricingId = resolvePricingId(
                model,
                provider.modelPricingIds ?? {},
              );
              const pricing = pricingId
                ? (allPricing.find((p) => p.model_id === pricingId) ?? null)
                : null;

              return (
                <div
                  key={model}
                  className={cn(
                    'rounded-lg px-3 py-2',
                    isAgent
                      ? 'bg-muted/50'
                      : 'bg-muted/30 border-muted border border-dashed',
                  )}
                >
                  <div className="flex items-center gap-2">
                    {/* Expand chevron */}
                    <button
                      type="button"
                      onClick={() => onToggleModelExpand(provider, model)}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={
                        isExpanded
                          ? t.settings.modelCollapsePricing
                          : t.settings.modelExpandPricing
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>

                    {/* Model name — inline editable */}
                    {isRenaming ? (
                      <input
                        type="text"
                        autoFocus
                        value={renamingModel.value}
                        onChange={(e) =>
                          onRenamingModelChange({
                            index,
                            value: e.target.value,
                          })
                        }
                        onBlur={() =>
                          onModelRename(provider, index, renamingModel.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter')
                            onModelRename(provider, index, renamingModel.value);
                          if (e.key === 'Escape') onRenamingModelChange(null);
                        }}
                        className="border-input bg-background text-foreground focus:ring-ring min-w-0 flex-1 rounded border px-2 py-0.5 text-sm focus:ring-1 focus:outline-none"
                        title={t.settings.modelRenameHint}
                      />
                    ) : (
                      <span
                        className="text-foreground min-w-0 flex-1 cursor-text truncate text-sm"
                        title={t.settings.modelRenameHint}
                        onDoubleClick={() =>
                          onRenamingModelChange({ index, value: model })
                        }
                      >
                        {model}
                      </span>
                    )}

                    {/* Test button */}
                    {isProviderConfigured(provider) && provider.baseUrl && (
                      <button
                        onClick={() => testProviderModel(provider, model)}
                        disabled={isTesting}
                        className={cn(
                          'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                          isTesting
                            ? 'text-muted-foreground cursor-wait'
                            : hasResult && testResult.success
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : hasResult && !testResult.success
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : 'text-primary hover:bg-accent',
                        )}
                        title={
                          hasResult
                            ? testResult.message
                            : t.settings.testConnection
                        }
                        aria-label={`Test model ${model}`}
                      >
                        {isTesting ? (
                          <span className="flex items-center gap-1">
                            <Loader2 className="size-3 animate-spin" />
                            {t.settings.testingConnection}
                          </span>
                        ) : hasResult && testResult.success ? (
                          <span className="flex items-center gap-1">
                            <Check className="size-3" />
                            {t.settings.testSuccess} ({testResult.latencyMs}ms)
                          </span>
                        ) : hasResult && !testResult.success ? (
                          <span>{t.settings.testFailed}</span>
                        ) : (
                          t.settings.testConnection
                        )}
                      </button>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => {
                        const newModels = provider.models.filter(
                          (_, i) => i !== index,
                        );
                        onProviderUpdate(provider.id, {
                          models:
                            newModels.length > 0 ? newModels : ['default'],
                        });
                      }}
                      className="text-muted-foreground hover:text-destructive shrink-0 p-1"
                      title={t.settings.deleteModel}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {/* Capability badges row */}
                  <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                    <ModelCapabilityBadges modelName={model} />
                    {!isAgent && (
                      <span className="text-muted-foreground text-[10px] italic">
                        {t.settings.notAgentCompatible}
                      </span>
                    )}
                  </div>

                  {/* Test error message */}
                  {hasResult && !testResult.success && (
                    <p className="mt-1 pl-6 text-xs text-red-500">
                      {testResult.message}
                    </p>
                  )}

                  {/* Pricing panel */}
                  {isExpanded && (
                    <ModelPricingPanel
                      pricing={pricing}
                      pricingModelId={pricingId ?? model}
                      defaultBillingType={provider.billingType}
                      onUpdated={(updated) => {
                        onPricingUpdated(updated);
                        if (!provider.modelPricingIds?.[model]) {
                          onProviderUpdate(provider.id, {
                            modelPricingIds: {
                              ...(provider.modelPricingIds ?? {}),
                              [model]: updated.model_id,
                            },
                          });
                        }
                      }}
                    />
                  )}
                </div>
              );
            })}

            {/* Add Model Input */}
            {showAddModel && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newModelName.trim()) {
                      const name = newModelName.trim();
                      const currentModels = provider.models || [];
                      if (!currentModels.includes(name)) {
                        const pricingId = await onEnsurePricingRecord(
                          name,
                          provider,
                        );
                        onProviderUpdate(provider.id, {
                          models: [...currentModels, name],
                          modelPricingIds: {
                            ...(provider.modelPricingIds ?? {}),
                            [name]: pricingId,
                          },
                        });
                      }
                      setNewModelName('');
                      setShowAddModel(false);
                    } else if (e.key === 'Escape') {
                      setNewModelName('');
                      setShowAddModel(false);
                    }
                  }}
                  placeholder={t.settings.enterModelName}
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={async () => {
                    const name = newModelName.trim();
                    if (name) {
                      const currentModels = provider.models || [];
                      if (!currentModels.includes(name)) {
                        const pricingId = await onEnsurePricingRecord(
                          name,
                          provider,
                        );
                        onProviderUpdate(provider.id, {
                          models: [...currentModels, name],
                          modelPricingIds: {
                            ...(provider.modelPricingIds ?? {}),
                            [name]: pricingId,
                          },
                        });
                      }
                      setNewModelName('');
                      setShowAddModel(false);
                    }
                  }}
                  disabled={!newModelName.trim()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-lg px-3 text-sm disabled:opacity-50"
                >
                  {t.settings.add}
                </button>
                <button
                  onClick={() => {
                    setNewModelName('');
                    setShowAddModel(false);
                  }}
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}

            {/* Suggested Models */}
            {!showAddModel &&
              getSuggestedModels(provider).filter(
                (model) => !(provider.models || []).includes(model),
              ).length > 0 && (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs">
                    {t.settings.suggestedModels}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {getSuggestedModels(provider)
                      .filter(
                        (model) => !(provider.models || []).includes(model),
                      )
                      .slice(0, 4)
                      .map((model) => (
                        <button
                          key={model}
                          onClick={() => {
                            const currentModels = provider.models || [];
                            if (!currentModels.includes(model)) {
                              onProviderUpdate(provider.id, {
                                models: [...currentModels, model],
                              });
                            }
                          }}
                          className="bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-full px-3 py-1 text-xs transition-colors"
                        >
                          + {model}
                        </button>
                      ))}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
