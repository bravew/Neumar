/**
 * MemorySettingsConfig — card-based configuration UI for the memory system.
 *
 * Grouped into: Core, Embedding, Recall, Advanced (collapsible).
 * Data Management (reindex/export/import) lives in MemoryDataActions.
 */

import { useState } from 'react';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  XCircle,
} from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { ApiKeyField } from './ApiKeyField';
import { Switch } from './Switch';

// ── Types ──

export interface MemoryConfigForm {
  enabled: boolean;
  autoCapture: boolean;
  autoRecall: boolean;
  embeddingProvider: 'local' | 'openai' | 'gemini';
  embeddingApiKey: string;
  embeddingModel: string;
  recallLimit: number;
  recallThreshold: number;
  llmCapture: boolean;
  sessionIndexing: boolean;
  decayEnabled: boolean;
  consolidationEnabled: boolean;
  entityExtractionEnabled: boolean;
  captureGuardLevel: 'strict' | 'standard' | 'relaxed';
  // v3 (memdir-inspired)
  llmRerankEnabled: boolean;
  journalMode: boolean;
}

export interface ModelStatus {
  state: 'not_downloaded' | 'downloading' | 'loading' | 'ready' | 'error';
  progress?: { downloadedBytes: number; totalBytes: number };
  message?: string;
}

export const defaultConfig: MemoryConfigForm = {
  enabled: true,
  autoCapture: true,
  autoRecall: true,
  embeddingProvider: 'local',
  embeddingApiKey: '',
  embeddingModel: '',
  recallLimit: 5,
  recallThreshold: 0.3,
  llmCapture: false,
  sessionIndexing: true,
  decayEnabled: false,
  consolidationEnabled: false,
  entityExtractionEnabled: false,
  captureGuardLevel: 'standard',
  // v3
  llmRerankEnabled: false,
  journalMode: false,
};

const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

const CARD = 'border-border rounded-lg border p-4';

// ── Reusable sub-components ──

function SettingsCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(CARD, className)}>
      <h3 className="text-foreground mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="min-w-0 flex-1 pr-4">
        <p className="text-foreground text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs leading-snug">
          {description}
        </p>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

// ── Props ──

interface MemorySettingsConfigProps {
  config: MemoryConfigForm;
  setConfig: React.Dispatch<React.SetStateAction<MemoryConfigForm>>;
  modelStatus: ModelStatus | null;
  saving: boolean;
  onSaveAll: () => void;
  onToggle: (key: keyof MemoryConfigForm, value: boolean) => void;
  onTriggerModelDownload: () => void;
}

export function MemorySettingsConfig({
  config,
  setConfig,
  modelStatus,
  saving,
  onSaveAll,
  onToggle,
  onTriggerModelDownload,
}: MemorySettingsConfigProps) {
  const { t } = useLanguage();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Check if any advanced feature is enabled (show indicator)
  const advancedActiveCount = [
    config.llmCapture,
    config.sessionIndexing,
    config.decayEnabled,
    config.consolidationEnabled,
    config.entityExtractionEnabled,
    config.llmRerankEnabled,
    config.journalMode,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* ── Core Settings ── */}
      <SettingsCard title={t.settings.memoryEnabled ?? 'Memory'}>
        <div className="divide-border space-y-0 divide-y">
          <ToggleRow
            label={t.settings.memoryEnabled ?? 'Enable Memory'}
            description={
              t.settings.memoryEnabledDescription ??
              'Store and recall information across sessions'
            }
            checked={config.enabled}
            onChange={(v) => onToggle('enabled', v)}
          />
          <ToggleRow
            label={t.settings.memoryAutoCapture ?? 'Auto-Capture'}
            description={
              t.settings.memoryAutoCaptureDescription ??
              'Automatically capture important information from conversations'
            }
            checked={config.autoCapture}
            onChange={(v) => onToggle('autoCapture', v)}
          />
          <ToggleRow
            label={t.settings.memoryAutoRecall ?? 'Auto-Recall'}
            description={
              t.settings.memoryAutoRecallDescription ??
              'Inject relevant memories before agent runs'
            }
            checked={config.autoRecall}
            onChange={(v) => onToggle('autoRecall', v)}
          />
        </div>
      </SettingsCard>

      <div
        className={cn(
          'space-y-4 transition-opacity',
          !config.enabled && 'pointer-events-none opacity-40',
        )}
      >
        {/* ── Embedding & Recall (side by side on wider screens) ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Embedding */}
          <div className={CARD}>
            <h3 className="text-foreground mb-3 text-sm font-semibold">
              {t.settings.memoryEmbeddingProvider ?? 'Embedding Provider'}
            </h3>
            <select
              aria-label={
                t.settings.memoryEmbeddingProvider ?? 'Embedding Provider'
              }
              value={config.embeddingProvider}
              onChange={(e) => {
                const value = e.target
                  .value as MemoryConfigForm['embeddingProvider'];
                setConfig((prev) => ({ ...prev, embeddingProvider: value }));
              }}
              className={INPUT_CLASS}
            >
              <option value="local">
                {t.settings.memoryEmbeddingProviderLocal ?? 'Local (offline)'}
              </option>
              <option value="openai">
                {t.settings.memoryEmbeddingProviderOpenAI ?? 'OpenAI'}
              </option>
              <option value="gemini">
                {t.settings.memoryEmbeddingProviderGemini ?? 'Gemini'}
              </option>
            </select>

            {/* Model status */}
            {config.embeddingProvider === 'local' && modelStatus && (
              <ModelStatusBanner
                status={modelStatus}
                onDownload={onTriggerModelDownload}
              />
            )}

            {config.embeddingProvider !== 'local' && (
              <div className="mt-3">
                <label className="text-foreground/80 mb-1 block text-xs font-medium">
                  {t.settings.memoryApiKey ?? 'API Key'}
                </label>
                <ApiKeyField
                  value={config.embeddingApiKey}
                  onChange={(v) =>
                    setConfig((prev) => ({ ...prev, embeddingApiKey: v }))
                  }
                  placeholder={
                    config.embeddingProvider === 'openai' ? 'sk-...' : 'AI...'
                  }
                  className={INPUT_CLASS}
                />
              </div>
            )}
          </div>

          {/* Recall */}
          <div className={CARD}>
            <h3 className="text-foreground mb-3 text-sm font-semibold">
              {t.settings.memoryAutoRecall ?? 'Recall'}
            </h3>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="recall-limit"
                  className="text-foreground/80 mb-1 block text-xs font-medium"
                >
                  {t.settings.memoryRecallLimit ?? 'Recall Limit'}
                </label>
                <input
                  id="recall-limit"
                  type="number"
                  min={1}
                  max={20}
                  value={config.recallLimit}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      recallLimit: parseInt(e.target.value) || 5,
                    }))
                  }
                  className={INPUT_CLASS}
                />
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {t.settings.memoryRecallLimitDescription ??
                    'Maximum memories injected per turn'}
                </p>
              </div>
              <div>
                <label
                  htmlFor="recall-threshold"
                  className="text-foreground/80 mb-1 block text-xs font-medium"
                >
                  {t.settings.memoryRecallThreshold ?? 'Recall Threshold'}
                </label>
                <input
                  id="recall-threshold"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={config.recallThreshold}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      recallThreshold: parseFloat(e.target.value) || 0.3,
                    }))
                  }
                  className={INPUT_CLASS}
                />
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {t.settings.memoryRecallThresholdDescription ??
                    'Minimum similarity score (0–1)'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Advanced Features (collapsible) ── */}
        <div className={CARD}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((p) => !p)}
            className="flex w-full items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-foreground text-sm font-semibold">
                {t.settings.memoryAdvancedFeatures ?? 'Advanced Features'}
              </h3>
              {advancedActiveCount > 0 && (
                <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                  {advancedActiveCount} active
                </span>
              )}
            </div>
            <ChevronDown
              size={16}
              className={cn(
                'text-muted-foreground transition-transform',
                advancedOpen && 'rotate-180',
              )}
            />
          </button>

          {advancedOpen && (
            <div className="divide-border mt-3 space-y-0 divide-y">
              <ToggleRow
                label={t.settings.memoryLLMCapture ?? 'LLM Capture'}
                description={
                  t.settings.memoryLLMCaptureDescription ??
                  'Use LLM to extract structured facts from conversations'
                }
                checked={config.llmCapture}
                onChange={(v) => onToggle('llmCapture', v)}
              />
              <ToggleRow
                label={t.settings.memorySessionIndexing ?? 'Session Indexing'}
                description={
                  t.settings.memorySessionIndexingDescription ??
                  'Index transcripts for cross-session semantic recall'
                }
                checked={config.sessionIndexing}
                onChange={(v) => onToggle('sessionIndexing', v)}
              />
              <ToggleRow
                label={t.settings.memoryDecayEnabled ?? 'Temporal Decay'}
                description={
                  t.settings.memoryDecayEnabledDescription ??
                  'Memories fade over time based on type and access patterns'
                }
                checked={config.decayEnabled}
                onChange={(v) => onToggle('decayEnabled', v)}
              />
              <ToggleRow
                label={
                  t.settings.memoryConsolidationEnabled ?? 'Auto-Consolidation'
                }
                description={
                  t.settings.memoryConsolidationEnabledDescription ??
                  'Periodically merge similar memories'
                }
                checked={config.consolidationEnabled}
                onChange={(v) => onToggle('consolidationEnabled', v)}
              />
              <ToggleRow
                label={t.settings.memoryEntityExtraction ?? 'Entity Extraction'}
                description={
                  t.settings.memoryEntityExtractionDescription ??
                  'Extract people, projects, and technologies from memories'
                }
                checked={config.entityExtractionEnabled}
                onChange={(v) => onToggle('entityExtractionEnabled', v)}
              />
              <ToggleRow
                label={t.settings.memoryLLMRerank ?? 'LLM Reranking'}
                description={
                  t.settings.memoryLLMRerankDescription ??
                  'Use AI to select the most task-relevant memories (adds ~200ms latency)'
                }
                checked={config.llmRerankEnabled}
                onChange={(v) => onToggle('llmRerankEnabled', v)}
              />
              <ToggleRow
                label={t.settings.memoryJournalMode ?? 'Journal Mode'}
                description={
                  t.settings.memoryJournalModeDescription ??
                  'Accumulate observations during session, distill into memories at end'
                }
                checked={config.journalMode}
                onChange={(v) => onToggle('journalMode', v)}
              />
              <div className="pt-2">
                <label className="text-foreground/80 mb-1 block text-xs font-medium">
                  {t.settings.memoryCaptureGuardLevel ?? 'Capture Sensitivity'}
                </label>
                <select
                  aria-label={
                    t.settings.memoryCaptureGuardLevel ?? 'Capture Sensitivity'
                  }
                  value={config.captureGuardLevel}
                  onChange={(e) => {
                    const value = e.target
                      .value as MemoryConfigForm['captureGuardLevel'];
                    setConfig((prev) => ({
                      ...prev,
                      captureGuardLevel: value,
                    }));
                  }}
                  className={INPUT_CLASS}
                >
                  <option value="strict">
                    {t.settings.memoryCaptureGuardStrict ??
                      'Strict — high-confidence only'}
                  </option>
                  <option value="standard">
                    {t.settings.memoryCaptureGuardStandard ??
                      'Standard — balanced'}
                  </option>
                  <option value="relaxed">
                    {t.settings.memoryCaptureGuardRelaxed ??
                      'Relaxed — capture more'}
                  </option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Save */}
        <button
          type="button"
          onClick={onSaveAll}
          disabled={saving}
          className={cn(
            'w-full rounded-md px-6 py-2 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {saving ? '...' : (t.settings.connectorSave ?? 'Save Settings')}
        </button>
      </div>
    </div>
  );
}

function ModelStatusBanner({
  status,
  onDownload,
}: {
  status: ModelStatus;
  onDownload: () => void;
}) {
  const { t } = useLanguage();

  const colorMap: Record<string, string> = {
    not_downloaded: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    downloading: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    loading: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
    ready: 'bg-green-500/10 text-green-700 dark:text-green-400',
    error: 'bg-red-500/10 text-red-700 dark:text-red-400',
  };

  return (
    <div
      className={cn(
        'mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-xs',
        colorMap[status.state],
      )}
    >
      {status.state === 'not_downloaded' && (
        <>
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">
            {t.settings.memoryModelNotDownloaded ??
              'Model not downloaded (~340 MB)'}
          </span>
          <button
            type="button"
            onClick={onDownload}
            className="shrink-0 rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-700"
          >
            {t.settings.memoryModelDownload ?? 'Download'}
          </button>
        </>
      )}
      {status.state === 'downloading' && (
        <>
          <Loader2 size={14} className="shrink-0 animate-spin" />
          <div className="flex-1">
            <span>{t.settings.memoryModelDownloading ?? 'Downloading...'}</span>
            {status.progress && status.progress.totalBytes > 0 && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{
                    width: `${Math.round((status.progress.downloadedBytes / status.progress.totalBytes) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        </>
      )}
      {status.state === 'loading' && (
        <>
          <Loader2 size={14} className="shrink-0 animate-spin" />
          <span>
            {status.message ??
              t.settings.memoryModelLoading ??
              'Loading model...'}
          </span>
        </>
      )}
      {status.state === 'ready' && (
        <>
          <CheckCircle2 size={14} className="shrink-0" />
          <span>
            gte-multilingual-base — {t.settings.memoryModelReady ?? 'Ready'}
          </span>
        </>
      )}
      {status.state === 'error' && (
        <>
          <XCircle size={14} className="shrink-0" />
          <span className="flex-1">
            {status.message ?? t.settings.memoryModelError ?? 'Failed to load'}
          </span>
          <button
            type="button"
            onClick={onDownload}
            className="shrink-0 rounded bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
          >
            {t.settings.memoryModelRetry ?? 'Retry'}
          </button>
        </>
      )}
    </div>
  );
}
