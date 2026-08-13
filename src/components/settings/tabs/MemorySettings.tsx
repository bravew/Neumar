/**
 * Memory Settings Tab
 *
 * Uses MCP-style tab layout: Settings | Explorer | Memories
 * Each tab gets its own full-height scrollable content area.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { MemoryAuditPanel } from '../components/MemoryAuditPanel';
import { MemoryDataActions } from '../components/MemoryDataActions';
import { MemoryExplorer } from '../components/MemoryExplorer';
import {
  defaultConfig,
  MemorySettingsConfig,
} from '../components/MemorySettingsConfig';
import type {
  MemoryConfigForm,
  ModelStatus,
} from '../components/MemorySettingsConfig';
import { MemoryTable } from '../components/MemoryTable';
import { WorkspaceRagCard } from '../components/WorkspaceRagCard';

type MemoryTab = 'settings' | 'explorer' | 'memories' | 'audit';

export function MemorySettings() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<MemoryTab>('settings');
  const [config, setConfig] = useState<MemoryConfigForm>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cacheCount, setCacheCount] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [pollModelStatus, setPollModelStatus] = useState(false);
  const modelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config from backend
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function loadData() {
      try {
        const [configRes, cacheRes] = await Promise.all([
          fetch(`${API_BASE_URL}/memory/config`, { signal }),
          fetch(`${API_BASE_URL}/memory/cache/stats`, { signal }),
        ]);
        if (configRes.ok) {
          const data = await configRes.json();
          setConfig({
            enabled: data.enabled ?? true,
            autoCapture: data.autoCapture ?? true,
            autoRecall: data.autoRecall ?? true,
            embeddingProvider: data.embeddingProvider ?? 'local',
            embeddingApiKey: data.embeddingApiKey ?? '',
            embeddingModel: data.embeddingModel ?? '',
            recallLimit: data.recallLimit ?? 5,
            recallThreshold: data.recallThreshold ?? 0.3,
            llmCapture: data.llmCapture ?? false,
            sessionIndexing: data.sessionIndexing ?? true,
            decayEnabled: data.decayEnabled ?? false,
            consolidationEnabled: data.consolidationEnabled ?? false,
            entityExtractionEnabled: data.entityExtractionEnabled ?? false,
            captureGuardLevel: data.captureGuardLevel ?? 'standard',
            llmRerankEnabled: data.llmRerankEnabled ?? false,
            journalMode: data.journalMode ?? false,
          });
        }
        if (cacheRes.ok) {
          const data = await cacheRes.json();
          setCacheCount(data.total ?? 0);
        }
      } catch {
        // Backend might not be running
      } finally {
        setLoading(false);
      }
    }
    loadData();
    return () => controller.abort();
  }, []);

  const s = t.settings as Record<string, string>;

  const saveConfig = useCallback(
    async (updates: Partial<MemoryConfigForm>) => {
      setSaving(true);
      try {
        const res = await fetch(`${API_BASE_URL}/memory/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(s.toastSettingsSaved ?? 'Settings saved');
      } catch {
        toast.error(s.toastSettingsSaveFailed ?? 'Failed to save settings');
      } finally {
        setSaving(false);
      }
    },
    [s],
  );

  const handleToggle = useCallback(
    (key: keyof MemoryConfigForm, value: boolean) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      saveConfig({ [key]: value });
    },
    [saveConfig],
  );

  const handleSaveAll = useCallback(async () => {
    await saveConfig({
      embeddingProvider: config.embeddingProvider,
      embeddingApiKey: config.embeddingApiKey,
      embeddingModel: config.embeddingModel,
      recallLimit: config.recallLimit,
      recallThreshold: config.recallThreshold,
      captureGuardLevel: config.captureGuardLevel,
    });
  }, [config, saveConfig]);

  const triggerModelDownload = useCallback(async () => {
    await fetch(`${API_BASE_URL}/memory/model/download`, { method: 'POST' });
    setModelStatus({
      state: 'downloading',
      progress: { downloadedBytes: 0, totalBytes: 0 },
    });
    setPollModelStatus(true);
  }, []);

  // Poll model status
  useEffect(() => {
    if (config.embeddingProvider !== 'local') {
      setModelStatus(null);
      return;
    }
    let active = true;
    async function fetchStatus() {
      try {
        const res = await fetch(`${API_BASE_URL}/memory/model/status`);
        if (res.ok && active) {
          const data: ModelStatus = await res.json();
          setModelStatus(data);
          if (data.state !== 'downloading' && data.state !== 'loading') {
            setPollModelStatus(false);
          }
          return data.state;
        }
      } catch {
        /* */
      }
      return null;
    }
    fetchStatus().then((state) => {
      if (active && (state === 'downloading' || state === 'loading')) {
        setPollModelStatus(true);
      }
    });
    return () => {
      active = false;
    };
  }, [config.embeddingProvider]);

  useEffect(() => {
    if (!pollModelStatus) {
      if (modelPollRef.current) {
        clearInterval(modelPollRef.current);
        modelPollRef.current = null;
      }
      return;
    }
    modelPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/memory/model/status`);
        if (res.ok) {
          const data: ModelStatus = await res.json();
          setModelStatus(data);
          if (data.state !== 'downloading' && data.state !== 'loading') {
            setPollModelStatus(false);
          }
        }
      } catch {
        setPollModelStatus(false);
      }
    }, 2_000);
    return () => {
      if (modelPollRef.current) {
        clearInterval(modelPollRef.current);
        modelPollRef.current = null;
      }
    };
  }, [pollModelStatus]);

  const refreshStats = useCallback(() => {}, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  const tabs: { key: MemoryTab; label: string }[] = [
    {
      key: 'settings',
      label: t.settings.memoryTabSettings ?? 'Settings',
    },
    {
      key: 'explorer',
      label: t.settings.memorySearch ?? 'Explorer',
    },
    {
      key: 'memories',
      label: t.settings.memoryStoredMemories ?? 'Memories',
    },
    {
      key: 'audit',
      label: (t.settings as Record<string, string>).memoryTabAudit ?? 'Audit',
    },
  ];

  return (
    <div className="-m-6 flex h-[calc(100%+48px)] flex-col">
      {/* Tab Bar — matches MCP tab pattern */}
      <div className="border-border shrink-0 border-b px-6">
        <div className="flex items-center gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area — full height, independently scrollable */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <MemorySettingsConfig
              config={config}
              setConfig={setConfig}
              modelStatus={modelStatus}
              saving={saving}
              onSaveAll={handleSaveAll}
              onToggle={handleToggle}
              onTriggerModelDownload={triggerModelDownload}
            />
            <WorkspaceRagCard />
          </div>
        )}

        {activeTab === 'explorer' && <MemoryExplorer />}

        {activeTab === 'memories' && (
          <div className="space-y-4">
            <MemoryDataActions cacheCount={cacheCount} />
            <MemoryTable onStatsChange={refreshStats} />
          </div>
        )}

        {activeTab === 'audit' && (
          <MemoryAuditPanel allowSessionChooser refreshIntervalMs={0} />
        )}
      </div>
    </div>
  );
}
