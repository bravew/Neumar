/**
 * Onboarding Step 3: AI Provider
 *
 * Select and configure an AI provider with API key + test connection.
 */

import { useEffect, useRef, useState } from 'react';

import { openUrl } from '@tauri-apps/plugin-opener';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { providerSvgIcons } from '@/components/settings/constants';
import { API_BASE_URL } from '@/config';
import type { AIProvider, Settings } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface ProviderStepProps {
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export function ProviderStep({
  settings,
  onSettingsChange,
}: ProviderStepProps) {
  const { t } = useLanguage();
  const ob = t.onboarding;
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [testState, setTestState] = useState<
    'idle' | 'testing' | 'success' | 'failed'
  >('idle');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Filter to providers visible in onboarding (exclude elevenlabs — it's a speech-only provider)
  const configProviders = settings.providers.filter(
    (p) => p.id !== 'elevenlabs',
  );
  const selectedProvider = selectedProviderId
    ? settings.providers.find((p) => p.id === selectedProviderId)
    : null;

  const handleProviderSelect = (providerId: string) => {
    setSelectedProviderId((prev) => (prev === providerId ? null : providerId));
    setTestState('idle'); // Reset test state when switching providers
  };

  const handleApiKeyChange = (providerId: string, apiKey: string) => {
    const updated = settings.providers.map((p) =>
      p.id === providerId ? { ...p, apiKey } : p,
    );
    onSettingsChange({ ...settings, providers: updated });
    setTestState('idle');
  };

  const openExternalUrl = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  const handleOllamaUrlChange = (url: string) => {
    const updated = settings.providers.map((p) =>
      p.id === 'ollama' ? { ...p, baseUrl: url } : p,
    );
    onSettingsChange({ ...settings, providers: updated });
    setTestState('idle');
  };

  const handleTestConnection = async (provider: AIProvider) => {
    setTestState('testing');
    try {
      if (provider.id === 'ollama') {
        // Ollama: test by hitting /api/tags (no API key needed)
        const url = (provider.baseUrl || 'http://localhost:11434').replace(
          /\/+$/,
          '',
        );
        const res = await fetch(`${url}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (mountedRef.current) {
          setTestState(res.ok ? 'success' : 'failed');
          if (res.ok && !provider.enabled) {
            const updated = settings.providers.map((p) =>
              p.id === 'ollama' ? { ...p, enabled: true } : p,
            );
            onSettingsChange({ ...settings, providers: updated });
          }
        }
      } else {
        if (!provider.apiKey) return;
        const res = await fetch(`${API_BASE_URL}/providers/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: provider.models[0] ?? '',
            agentType: provider.agentType,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const result = (await res.json()) as { success: boolean };
        if (mountedRef.current)
          setTestState(result.success ? 'success' : 'failed');
      }
    } catch {
      if (mountedRef.current) setTestState('failed');
    }
  };

  return (
    <div>
      <h1 className="text-foreground text-center text-3xl font-bold">
        {ob.providerTitle}
      </h1>
      <p className="text-muted-foreground mt-3 text-center text-base">
        {ob.providerSubtitle}
      </p>
      <p className="text-muted-foreground mt-2 text-center text-sm italic">
        {ob.providerOptionalNote}
      </p>

      <div className="mt-6 space-y-4">
        {/* Provider List */}
        <div className="grid grid-cols-3 gap-3">
          {configProviders.map((provider) => {
            const isSelected = selectedProviderId === provider.id;
            const isConfigured =
              provider.id === 'ollama' ? provider.enabled : !!provider.apiKey;
            return (
              <button
                type="button"
                key={provider.id}
                onClick={() => handleProviderSelect(provider.id)}
                className={cn(
                  'border-border flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
                  isSelected
                    ? 'border-primary ring-primary/20 ring-2'
                    : 'hover:border-primary/50',
                )}
              >
                <div className="bg-muted text-foreground flex size-10 items-center justify-center rounded-lg p-2 text-lg font-bold">
                  {providerSvgIcons[provider.id] ||
                    provider.icon ||
                    provider.name[0]}
                </div>
                <span className="text-foreground text-sm font-medium">
                  {provider.name}
                </span>
                {isConfigured && (
                  <span className="text-xs text-green-600 dark:text-green-400">
                    {ob.providerConfigured}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected Provider Config */}
        <AnimatePresence mode="wait">
          {selectedProvider && (
            <motion.div
              key={selectedProvider.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-border space-y-3 rounded-xl border p-4">
                {selectedProvider.id === 'ollama' ? (
                  <>
                    {/* Ollama: URL field instead of API key */}
                    <label className="text-foreground text-sm font-medium">
                      {ob.ollamaUrl}
                    </label>
                    <input
                      type="text"
                      value={selectedProvider.baseUrl}
                      onChange={(e) => handleOllamaUrlChange(e.target.value)}
                      placeholder={ob.ollamaUrlPlaceholder}
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring block h-10 w-full rounded-lg border px-3 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
                    />
                  </>
                ) : (
                  <>
                    {/* API key providers */}
                    <div className="flex items-center justify-between">
                      <label className="text-foreground text-sm font-medium">
                        {ob.apiKey}
                      </label>
                      {selectedProvider.apiKeyUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            openExternalUrl(selectedProvider.apiKeyUrl!)
                          }
                          className="text-primary flex cursor-pointer items-center gap-1 text-xs hover:underline"
                        >
                          {ob.getApiKey}
                          <ExternalLink className="size-3" />
                        </button>
                      )}
                    </div>
                    <input
                      type="password"
                      value={selectedProvider.apiKey}
                      onChange={(e) =>
                        handleApiKeyChange(selectedProvider.id, e.target.value)
                      }
                      placeholder={ob.enterApiKey}
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring block h-10 w-full rounded-lg border px-3 font-mono text-sm focus:border-transparent focus:ring-2 focus:outline-none"
                    />
                  </>
                )}

                {/* Test Connection — show for Ollama always, for others only when API key is set */}
                {(selectedProvider.id === 'ollama' ||
                  selectedProvider.apiKey) && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleTestConnection(selectedProvider)}
                      disabled={testState === 'testing'}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                        testState === 'testing'
                          ? 'bg-muted text-muted-foreground cursor-wait'
                          : 'bg-primary/10 text-primary hover:bg-primary/20',
                      )}
                    >
                      {testState === 'testing' && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      {testState === 'success' && (
                        <CheckCircle2 className="size-4 text-green-500" />
                      )}
                      {testState === 'failed' && (
                        <AlertCircle className="size-4 text-red-500" />
                      )}
                      {testState === 'idle' && ob.testConnection}
                      {testState === 'testing' && ob.testingConnection}
                      {testState === 'success' && ob.connectionSuccess}
                      {testState === 'failed' && ob.connectionFailed}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
