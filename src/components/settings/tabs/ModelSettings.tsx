import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Plus, Settings, Trash2, X } from 'lucide-react';

import type { MediaConfig, TaskType } from '@/shared/db/settings';
import {
  DEFAULT_MEDIA_CONFIG,
  isAgentCapableModel,
  isProviderReady,
} from '@/shared/db/settings';
import type { ModelPricing } from '@/shared/db/usage-api';
import {
  createModelPricing,
  fetchPricing,
  renameModelPricing,
  updateModelPricing,
} from '@/shared/db/usage-api';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

import {
  customProviderModels,
  defaultProviderIds,
  providerDefaultModels,
  providerIcons,
  providerSvgIcons,
} from '../constants';
import type { AIProvider, ModelSubTab, SettingsTabProps } from '../types';
import { ModelRoutingSection } from './ModelRoutingSection';
import { ProviderDetailView } from './ProviderDetailView';

// ============================================================================
// Constants
// ============================================================================

/** Main agent providers pinned at top of the provider list in fixed order */
const MAIN_AGENT_PROVIDER_IDS = ['claude', 'codex', 'google-gemini'];

const MEDIA_SELECT_CLASS =
  'border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none';

type MediaProviderKey = 'defaultImageProvider' | 'defaultVideoProvider';

function MediaProviderSettings({
  media,
  onChange,
}: {
  media: MediaConfig;
  onChange: (next: MediaConfig) => void;
}) {
  const { t } = useLanguage();
  const autoLabel = t.settings.mediaProviderAuto;

  // Brand and model identifiers stay in English; only the descriptor is localized.
  const imageOptions = [
    { value: 'auto', label: autoLabel },
    { value: 'codex', label: 'Codex CLI (local · gpt-image-2)' },
    { value: 'byteplus', label: 'BytePlus (Seedream)' },
    { value: 'openai', label: 'OpenAI (DALL-E / gpt-image)' },
    { value: 'gemini', label: 'Google Gemini (Imagen)' },
  ];
  const videoOptions = [
    { value: 'auto', label: autoLabel },
    { value: 'byteplus', label: 'BytePlus (Seedance)' },
    { value: 'openai', label: 'OpenAI (Sora)' },
    { value: 'gemini', label: 'Google Gemini (Veo)' },
  ];
  const rows: Array<{
    key: MediaProviderKey;
    label: string;
    options: Array<{ value: string; label: string }>;
  }> = [
    {
      key: 'defaultImageProvider',
      label: t.settings.defaultImageProvider,
      options: imageOptions,
    },
    {
      key: 'defaultVideoProvider',
      label: t.settings.defaultVideoProvider,
      options: videoOptions,
    },
  ];

  return (
    <div className="space-y-4">
      <h4 className="text-foreground text-sm font-medium">
        {t.settings.mediaGeneration}
      </h4>
      <p className="text-muted-foreground text-xs">
        {t.settings.mediaGenerationDescription}
      </p>
      {rows.map(({ key, label, options }) => {
        const selectId = `media-${key}`;
        return (
          <div key={key} className="flex flex-col gap-2">
            <label
              htmlFor={selectId}
              className="text-foreground block text-sm font-medium"
            >
              {label}
            </label>
            <select
              id={selectId}
              value={media[key] || 'auto'}
              onChange={(e) => onChange({ ...media, [key]: e.target.value })}
              className={MEDIA_SELECT_CLASS}
            >
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

// Get suggested models for a provider
function getSuggestedModels(provider: AIProvider): string[] {
  // First check by provider ID
  if (providerDefaultModels[provider.id]) {
    return providerDefaultModels[provider.id];
  }

  // Then check custom provider models by name (case-insensitive)
  const providerNameLower = provider.name.toLowerCase();
  for (const [key, models] of Object.entries(customProviderModels)) {
    if (providerNameLower.includes(key.toLowerCase())) {
      return models;
    }
  }

  // Fall back to default
  return providerDefaultModels.default || [];
}

// ============================================================================
// Provider Button
// ============================================================================

function ProviderButton({
  provider,
  active,
  onClick,
}: {
  provider: AIProvider;
  active: boolean;
  onClick: () => void;
}) {
  const ready = isProviderReady(provider);
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
        active
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <span className="bg-muted text-muted-foreground relative flex size-6 items-center justify-center rounded p-1 text-xs font-medium">
        {providerSvgIcons[provider.id] ||
          providerIcons[provider.id] ||
          provider.name.charAt(0).toUpperCase()}
        {provider.enabled && ready && (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500" />
        )}
      </span>
      <span className="flex-1 text-left">{provider.name}</span>
    </button>
  );
}

export function ModelSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<ModelSubTab>('settings');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
    models: '',
  });
  // Pricing state
  const [allPricing, setAllPricing] = useState<ModelPricing[]>([]);
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [renamingModel, setRenamingModel] = useState<{
    index: number;
    value: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const { t } = useLanguage();

  // Load all pricing on mount
  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    fetchPricing(ac.signal)
      .then((data) => {
        if (mountedRef.current) setAllPricing(data);
      })
      .catch(() => {});
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, []);

  /** Resolve pricing record ID for a model name (exact → fuzzy date-suffix strip) */
  const resolvePricingId = useCallback(
    (modelName: string, pricingIds: Record<string, string>): string | null => {
      if (pricingIds[modelName]) return pricingIds[modelName];
      const exact = allPricing.find((p) => p.model_id === modelName);
      if (exact) return exact.model_id;
      const base = modelName.replace(/-\d{8}$/, '');
      const fuzzy = allPricing.find((p) => p.model_id === base);
      return fuzzy ? fuzzy.model_id : null;
    },
    [allPricing],
  );

  /** Ensure a model has a pricing record; creates one if missing. Returns pricingModelId. */
  const ensurePricingRecord = useCallback(
    async (modelName: string, provider: AIProvider): Promise<string> => {
      const resolved = resolvePricingId(
        modelName,
        provider.modelPricingIds ?? {},
      );
      if (resolved) return resolved;
      // Create a new record
      const created = await createModelPricing({
        model_id: modelName,
        provider: provider.name,
        display_name: modelName,
        default_billing_type: provider.billingType ?? 'api',
      });
      setAllPricing((prev) => [...prev, created]);
      return created.model_id;
    },
    [resolvePricingId],
  );

  /**
   * When a provider's billing type changes, push the new billing type to all
   * of its linked model pricing records so the cost display updates to $0 for
   * subscription/free providers without requiring per-model edits.
   */
  const syncProviderPricingBillingType = useCallback(
    async (provider: AIProvider, billingType: AIProvider['billingType']) => {
      if (!billingType) return;
      const pricingIds = provider.modelPricingIds ?? {};
      await Promise.allSettled(
        provider.models.map(async (model) => {
          const pricingId =
            resolvePricingId(model, pricingIds) ??
            (await ensurePricingRecord(model, provider));
          const updated = await updateModelPricing(pricingId, {
            default_billing_type: billingType,
          });
          setAllPricing((prev) =>
            prev.map((r) => (r.model_id === updated.model_id ? updated : r)),
          );
        }),
      );
    },
    [resolvePricingId, ensurePricingRecord],
  );

  // Get all available models from enabled providers (memoized to avoid defeating downstream useMemo)
  const availableModels = useMemo(
    () =>
      settings.providers
        .filter((p) => p.enabled && isProviderReady(p))
        .flatMap((p) => p.models.map((m) => ({ provider: p, model: m }))),
    [settings.providers],
  );

  // Only agent-capable (chat) models — used in routing selectors and default model dropdown
  const agentCapableModels = useMemo(
    () => availableModels.filter(({ model }) => isAgentCapableModel(model)),
    [availableModels],
  );

  // Sort providers: main agent providers first (fixed order), then others (enabled → configured → rest)
  const sortedProviders = useMemo(() => {
    const main = MAIN_AGENT_PROVIDER_IDS.flatMap((id) =>
      settings.providers.filter((p) => p.id === id),
    );
    const others = [...settings.providers]
      .filter((p) => !MAIN_AGENT_PROVIDER_IDS.includes(p.id))
      .sort((a, b) => {
        const ac = isProviderReady(a),
          bc = isProviderReady(b);
        if (a.enabled && ac && !(b.enabled && bc)) return -1;
        if (b.enabled && bc && !(a.enabled && ac)) return 1;
        if (ac && !bc) return -1;
        if (bc && !ac) return 1;
        return 0;
      });
    return { main, others };
  }, [settings.providers]);

  const selectedProvider = settings.providers.find(
    (p) => p.id === activeSubTab,
  );

  const handleProviderUpdate = useCallback(
    (providerId: string, updates: Partial<AIProvider>) => {
      const newProviders = settings.providers.map((p) => {
        if (p.id !== providerId) return p;
        const updated = { ...p, ...updates };
        if (
          'apiKey' in updates &&
          !updates.apiKey &&
          updated.enabled &&
          updated.billingType !== 'subscription' &&
          updated.billingType !== 'free'
        ) {
          updated.enabled = false;
        }
        return updated;
      });
      onSettingsChange({ ...settings, providers: newProviders });
    },
    [settings, onSettingsChange],
  );

  /** Rename a model entry: updates models[], modelPricingIds, and the pricing record */
  const handleModelRename = useCallback(
    async (provider: AIProvider, index: number, newName: string) => {
      const oldName = provider.models[index];
      if (!newName || newName === oldName) {
        setRenamingModel(null);
        return;
      }
      const oldPricingId = resolvePricingId(
        oldName,
        provider.modelPricingIds ?? {},
      );
      const newModels = [...provider.models];
      newModels[index] = newName;
      const newPricingIds = { ...(provider.modelPricingIds ?? {}) };
      if (oldPricingId && oldPricingId === oldName) {
        const renamed = await renameModelPricing(oldPricingId, newName);
        if (renamed) {
          setAllPricing((prev) =>
            prev.map((p) => (p.model_id === oldPricingId ? renamed : p)),
          );
          newPricingIds[newName] = newName;
        } else {
          newPricingIds[newName] = oldPricingId;
        }
      } else if (oldPricingId) {
        newPricingIds[newName] = oldPricingId;
      }
      delete newPricingIds[oldName];
      handleProviderUpdate(provider.id, {
        models: newModels,
        modelPricingIds: newPricingIds,
      });
      setRenamingModel(null);
      setExpandedModels((prev) => {
        const next = new Set(prev);
        if (next.has(`${provider.id}:${oldName}`)) {
          next.delete(`${provider.id}:${oldName}`);
          next.add(`${provider.id}:${newName}`);
        }
        return next;
      });
    },
    [resolvePricingId, handleProviderUpdate],
  );

  /** Toggle pricing expand for a model, auto-linking pricing if found */
  const toggleModelExpand = useCallback(
    (provider: AIProvider, modelName: string) => {
      const key = `${provider.id}:${modelName}`;
      if (expandedModels.has(key)) {
        setExpandedModels((prev) => {
          const s = new Set(prev);
          s.delete(key);
          return s;
        });
        return;
      }
      const pricingId = resolvePricingId(
        modelName,
        provider.modelPricingIds ?? {},
      );
      if (pricingId && !provider.modelPricingIds?.[modelName]) {
        handleProviderUpdate(provider.id, {
          modelPricingIds: {
            ...(provider.modelPricingIds ?? {}),
            [modelName]: pricingId,
          },
        });
      }
      setExpandedModels((prev) => new Set(prev).add(key));
    },
    [expandedModels, resolvePricingId, handleProviderUpdate],
  );

  const handleAddProvider = () => {
    if (!newProvider.name || !newProvider.baseUrl) return;
    const id = `custom-${randomUUID()}`;
    const models = newProvider.models
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m);

    const provider: AIProvider = {
      id,
      name: newProvider.name,
      apiKey: newProvider.apiKey,
      baseUrl: newProvider.baseUrl,
      enabled: true,
      models: models.length > 0 ? models : ['default'],
    };

    onSettingsChange({
      ...settings,
      providers: [...settings.providers, provider],
    });

    setNewProvider({ name: '', baseUrl: '', apiKey: '', models: '' });
    setShowAddProvider(false);
    setActiveSubTab(id);
  };

  const handleDeleteProvider = (providerId: string) => {
    const newProviders = settings.providers.filter((p) => p.id !== providerId);

    let newSettings = { ...settings, providers: newProviders };
    if (settings.defaultProvider === providerId) {
      const enabledProvider = newProviders.find((p) => p.enabled);
      if (enabledProvider) {
        newSettings.defaultProvider = enabledProvider.id;
        newSettings.defaultModel = enabledProvider.models[0] || '';
      }
    }

    onSettingsChange(newSettings);
    setActiveSubTab('settings');
  };

  // Update model routing for a specific task type
  const handleRoutingChange = (
    taskType: TaskType,
    field: 'provider' | 'model',
    value: string,
  ) => {
    const currentRouting = settings.modelRouting || {};
    const currentRoute = currentRouting[taskType] || {
      provider: 'default',
      model: '',
    };

    const updatedRoute = { ...currentRoute, [field]: value };

    // If provider changed to 'default', clear the model too
    if (field === 'provider' && value === 'default') {
      updatedRoute.model = '';
    }

    // If provider changed to a specific provider, pre-select its first agent-capable model
    if (field === 'provider' && value !== 'default') {
      const provider = settings.providers.find((p) => p.id === value);
      if (provider) {
        const firstAgentModel = provider.models.find((m) =>
          isAgentCapableModel(m),
        );
        updatedRoute.model = firstAgentModel || provider.models[0] || '';
      }
    }

    onSettingsChange({
      ...settings,
      modelRouting: {
        ...currentRouting,
        [taskType]: updatedRoute,
      },
    });
  };

  return (
    <div className="flex h-full">
      {/* Left Panel - Sub Navigation */}
      <div className="border-border flex min-h-0 w-52 flex-col border-r">
        {/* Model Settings Tab */}
        <div className="space-y-0.5 p-2">
          <button
            onClick={() => {
              setActiveSubTab('settings');
              setShowAddProvider(false);
            }}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
              activeSubTab === 'settings' && !showAddProvider
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Settings className="size-4" />
            <span className="flex-1 text-left">{t.settings.modelSettings}</span>
          </button>
        </div>

        {/* Providers Section */}
        <div className="border-border flex min-h-0 flex-1 flex-col border-t">
          <div className="text-muted-foreground flex shrink-0 items-center px-4 py-2 text-xs font-medium">
            {t.settings.providers}
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {sortedProviders.main.map((provider) => (
              <ProviderButton
                key={provider.id}
                provider={provider}
                active={activeSubTab === provider.id && !showAddProvider}
                onClick={() => {
                  setActiveSubTab(provider.id);
                  setShowAddProvider(false);
                }}
              />
            ))}
            {sortedProviders.others.length > 0 && (
              <div className="border-border mx-1 my-1 border-t" />
            )}
            {sortedProviders.others.map((provider) => (
              <ProviderButton
                key={provider.id}
                provider={provider}
                active={activeSubTab === provider.id && !showAddProvider}
                onClick={() => {
                  setActiveSubTab(provider.id);
                  setShowAddProvider(false);
                }}
              />
            ))}
          </div>
        </div>

        {/* Add/Remove Buttons */}
        <div className="border-border mt-auto flex items-center gap-1 border-t p-2">
          <button
            onClick={() => setShowAddProvider(true)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded transition-colors"
            title={t.settings.addProvider}
          >
            <Plus className="size-4" />
          </button>
          {selectedProvider &&
            !defaultProviderIds.includes(selectedProvider.id) && (
              <button
                onClick={() => handleDeleteProvider(selectedProvider.id)}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-7 items-center justify-center rounded transition-colors"
                title={t.settings.deleteProvider}
              >
                <Trash2 className="size-4" />
              </button>
            )}
        </div>
      </div>

      {/* Right Panel - Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {showAddProvider ? (
          /* Add Provider Form */
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-foreground text-base font-medium">
                {t.settings.addProvider}
              </h3>
              <button
                onClick={() => setShowAddProvider(false)}
                className="hover:bg-muted rounded p-1"
              >
                <X className="text-muted-foreground size-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.providerName}
                </label>
                <input
                  type="text"
                  value={newProvider.name}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, name: e.target.value })
                  }
                  placeholder="Claude"
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.apiKey}
                </label>
                <input
                  type="password"
                  value={newProvider.apiKey}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, apiKey: e.target.value })
                  }
                  placeholder={t.settings.enterApiKey}
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.apiBaseUrl}
                </label>
                <input
                  type="text"
                  value={newProvider.baseUrl}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com/v1"
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.models}
                </label>
                <input
                  type="text"
                  value={newProvider.models}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, models: e.target.value })
                  }
                  placeholder={t.settings.modelsPlaceholder}
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              <button
                onClick={handleAddProvider}
                disabled={!newProvider.name || !newProvider.baseUrl}
                className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 h-10 w-full rounded-lg text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.settings.add}
              </button>
            </div>
          </div>
        ) : activeSubTab === 'settings' ? (
          /* Model Settings Panel */
          <div className="p-6">
            <div className="space-y-6">
              <div>
                <p className="text-muted-foreground text-sm">
                  {t.settings.modelDescription}
                </p>
              </div>

              {/* Default Model Selection */}
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.defaultModel}
                </label>
                <p className="text-muted-foreground text-xs">
                  {t.settings.defaultModelDescription}
                </p>
                <select
                  value={`${settings.defaultProvider}:${settings.defaultModel}`}
                  onChange={(e) => {
                    const [provider, model] = e.target.value.split(':');
                    onSettingsChange({
                      ...settings,
                      defaultProvider: provider,
                      defaultModel: model,
                    });
                  }}
                  className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                >
                  <option value="default:">{t.settings.defaultEnv}</option>
                  {agentCapableModels.map(({ provider, model }) => (
                    <option
                      key={`${provider.id}:${model}`}
                      value={`${provider.id}:${model}`}
                    >
                      {provider.name} / {model}
                    </option>
                  ))}
                </select>
                {settings.defaultProvider === 'default' && (
                  <p className="text-muted-foreground text-xs">
                    {t.settings.envHint}
                  </p>
                )}
              </div>

              {/* Add Custom Model Button */}
              <button
                onClick={() => setShowAddProvider(true)}
                className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm"
              >
                <Plus className="size-4" />
                {t.settings.addCustomModel}
              </button>

              <MediaProviderSettings
                media={settings.media ?? DEFAULT_MEDIA_CONFIG}
                onChange={(media) => onSettingsChange({ ...settings, media })}
              />

              {/* Model Routing Configuration */}
              <ModelRoutingSection
                providers={settings.providers}
                modelRouting={settings.modelRouting || {}}
                onRoutingChange={handleRoutingChange}
              />

              {/* Conversation History Settings */}
              <div className="space-y-4">
                <h4 className="text-foreground text-sm font-medium">
                  {t.settings.conversationHistoryLimits}
                </h4>

                {/* Max Conversation Turns */}
                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.maxConversationTurns}
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {t.settings.maxConversationTurnsDescription}
                  </p>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={settings.maxConversationTurns}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      onSettingsChange({
                        ...settings,
                        maxConversationTurns: Math.max(0, Math.min(100, value)),
                      });
                    }}
                    className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>

                {/* Max History Tokens */}
                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.maxHistoryTokens}
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {t.settings.maxHistoryTokensDescription}
                  </p>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="100"
                    value={settings.maxHistoryTokens}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      onSettingsChange({
                        ...settings,
                        maxHistoryTokens: Math.max(0, Math.min(10000, value)),
                      });
                    }}
                    className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : selectedProvider ? (
          <ProviderDetailView
            provider={selectedProvider}
            allPricing={allPricing}
            expandedModels={expandedModels}
            renamingModel={renamingModel}
            isProviderConfigured={isProviderReady}
            onProviderUpdate={handleProviderUpdate}
            onModelRename={handleModelRename}
            onToggleModelExpand={toggleModelExpand}
            onRenamingModelChange={setRenamingModel}
            onPricingUpdated={(updated) => {
              setAllPricing((prev) =>
                prev.some((p) => p.model_id === updated.model_id)
                  ? prev.map((p) =>
                      p.model_id === updated.model_id ? updated : p,
                    )
                  : [...prev, updated],
              );
            }}
            onEnsurePricingRecord={ensurePricingRecord}
            resolvePricingId={resolvePricingId}
            syncProviderPricingBillingType={syncProviderPricingBillingType}
            getSuggestedModels={getSuggestedModels}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {t.settings.selectProvider}
          </div>
        )}
      </div>
    </div>
  );
}
