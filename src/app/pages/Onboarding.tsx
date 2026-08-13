/**
 * Onboarding Page — First-time user experience
 *
 * Multi-step wizard shown on first launch (after dependency setup).
 * Steps: Welcome/Profile → Appearance → AI Provider → Local Models → Ready
 *
 * Reuses settings tab patterns and saves directly to the settings store.
 * Model download state is managed here (not inside ModelsStep) so that
 * downloads continue in the background even after the user moves to the
 * next step. A toast notification fires when each download finishes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import { AppearanceStep } from '@/components/onboarding/AppearanceStep';
import {
  isAnyModelInProgress,
  ModelsStep,
  type LocalModelState,
  type LocalModelStatusEntry,
  type SpeechLocalStatus,
} from '@/components/onboarding/ModelsStep';
import { ProviderStep } from '@/components/onboarding/ProviderStep';
import { ReadyStep } from '@/components/onboarding/ReadyStep';
import { WelcomeStep } from '@/components/onboarding/WelcomeStep';
import { API_BASE_URL } from '@/config';
import {
  getSettings,
  ONBOARDING_VERSION,
  saveSettingItem,
  saveSettings,
  syncSettingsWithBackend,
  type Settings,
} from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// Constants
// ============================================================================

const TOTAL_STEPS = 5;
const SAVE_DEBOUNCE_MS = 400;
const MODEL_POLL_INTERVAL = 2000;
const MODEL_POLL_MAX_DURATION = 600_000; // 10 min

// ============================================================================
// Main Component
// ============================================================================

interface OnboardingPageProps {
  onComplete: () => void;
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const { t, tt } = useLanguage();
  const ob = t.onboarding;
  const [step, setStep] = useState(0);
  const [settings, setSettingsState] = useState<Settings>(() => getSettings());
  const [direction, setDirection] = useState(1);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ── Local model download state (lifted from ModelsStep) ──────────────────
  const [speechStatus, setSpeechStatus] = useState<SpeechLocalStatus | null>(
    null,
  );
  const [memoryStatus, setMemoryStatus] =
    useState<LocalModelStatusEntry | null>(null);
  const [modelPolling, setModelPolling] = useState(false);
  const modelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelPollStartRef = useRef(0);
  const modelTickControllerRef = useRef<AbortController | null>(null);
  // Track previous model states to detect transitions → 'ready'
  const prevModelStatesRef = useRef<Record<string, LocalModelState>>({});

  // Fetch initial model statuses on mount
  useEffect(() => {
    const controller = new AbortController();
    async function fetchModelStatuses() {
      try {
        const [speechRes, memRes] = await Promise.all([
          fetch(`${API_BASE_URL}/speech/local/status`, {
            signal: controller.signal,
          }).catch(() => null),
          fetch(`${API_BASE_URL}/memory/model/status`, {
            signal: controller.signal,
          }).catch(() => null),
        ]);
        let newSpeech: SpeechLocalStatus | null = null;
        let newMemory: LocalModelStatusEntry | null = null;
        if (speechRes?.ok) newSpeech = await speechRes.json();
        if (memRes?.ok) newMemory = await memRes.json();
        setSpeechStatus(newSpeech);
        setMemoryStatus(newMemory);
        if (isAnyModelInProgress(newSpeech, newMemory)) setModelPolling(true);
      } catch {
        /* endpoints may not be available */
      }
    }
    fetchModelStatuses();
    return () => controller.abort();
  }, []);

  // Notify when a model finishes downloading
  const notifyModelReady = useCallback(
    (modelKey: string, label: string, newState: LocalModelState) => {
      const prev = prevModelStatesRef.current[modelKey];
      if (newState === 'ready' && prev !== undefined && prev !== 'ready') {
        toast.success(
          tt('onboarding.modelDownloadComplete', { modelName: label }),
        );
      }
      prevModelStatesRef.current[modelKey] = newState;
    },
    [tt],
  );

  const checkModelCompletions = useCallback(
    (
      newSpeech: SpeechLocalStatus | null,
      newMem: LocalModelStatusEntry | null,
    ) => {
      if (newSpeech) {
        notifyModelReady('stt', ob.sttModelLabel, newSpeech.stt.state);
        notifyModelReady(
          'kokoro',
          ob.ttsModelLabel,
          newSpeech.tts.kokoro.state,
        );
      }
      if (newMem) {
        notifyModelReady('memory', ob.embeddingModelLabel, newMem.state);
      }
    },
    [
      notifyModelReady,
      ob.sttModelLabel,
      ob.ttsModelLabel,
      ob.embeddingModelLabel,
    ],
  );

  // Background polling — continues even when user leaves the Models step
  useEffect(() => {
    if (!modelPolling) {
      if (modelPollRef.current) {
        clearInterval(modelPollRef.current);
        modelPollRef.current = null;
      }
      return;
    }
    modelPollStartRef.current = Date.now();

    modelPollRef.current = setInterval(async () => {
      if (Date.now() - modelPollStartRef.current > MODEL_POLL_MAX_DURATION) {
        setModelPolling(false);
        return;
      }
      const tickController = new AbortController();
      modelTickControllerRef.current = tickController;
      try {
        const [speechRes, memRes] = await Promise.all([
          fetch(`${API_BASE_URL}/speech/local/status`, {
            signal: tickController.signal,
          }).catch(() => null),
          fetch(`${API_BASE_URL}/memory/model/status`, {
            signal: tickController.signal,
          }).catch(() => null),
        ]);
        let newSpeech: SpeechLocalStatus | null = null;
        let newMemory: LocalModelStatusEntry | null = null;
        if (speechRes?.ok) {
          newSpeech = await speechRes.json();
          setSpeechStatus(newSpeech);
        }
        if (memRes?.ok) {
          newMemory = await memRes.json();
          setMemoryStatus(newMemory);
        }
        checkModelCompletions(newSpeech, newMemory);
        if (!isAnyModelInProgress(newSpeech, newMemory)) setModelPolling(false);
      } catch {
        setModelPolling(false);
      }
    }, MODEL_POLL_INTERVAL);

    return () => {
      if (modelPollRef.current) {
        clearInterval(modelPollRef.current);
        modelPollRef.current = null;
      }
      modelTickControllerRef.current?.abort();
      modelTickControllerRef.current = null;
    };
  }, [modelPolling, checkModelCompletions]);

  const handleSpeechDownload = useCallback(async (model: string) => {
    try {
      await fetch(`${API_BASE_URL}/speech/local/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      setModelPolling(true);
    } catch {
      /* ignore */
    }
  }, []);

  const handleMemoryDownload = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/memory/model/download`, { method: 'POST' });
      setMemoryStatus({
        state: 'downloading',
        progress: { downloadedBytes: 0, totalBytes: 0 },
      });
      setModelPolling(true);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Settings / navigation ────────────────────────────────────────────────

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveSettings(settingsRef.current);
      }
    };
  }, []);

  const handleSettingsChange = useCallback((newSettings: Settings) => {
    setSettingsState(newSettings);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSettings(newSettings);
      syncSettingsWithBackend().catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleComplete = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      saveSettings(settingsRef.current);
      await syncSettingsWithBackend().catch(() => {});
    }
    await Promise.all([
      saveSettingItem('onboardingCompleted', 'true'),
      saveSettingItem('onboardingVersion', ONBOARDING_VERSION),
    ]);
    onComplete();
  }, [onComplete]);

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <WelcomeStep
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        );
      case 1:
        return (
          <AppearanceStep
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        );
      case 2:
        return (
          <ProviderStep
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        );
      case 3:
        return (
          <ModelsStep
            speechStatus={speechStatus}
            memoryStatus={memoryStatus}
            onSpeechDownload={handleSpeechDownload}
            onMemoryDownload={handleMemoryDownload}
          />
        );
      case 4:
        return <ReadyStep settings={settings} />;
      default:
        return null;
    }
  };

  return (
    <div className="bg-background flex min-h-svh items-center justify-center">
      <div className="w-full max-w-2xl px-6">
        {/* Step Indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === step
                  ? 'bg-primary w-8'
                  : i < step
                    ? 'bg-primary/40 w-4'
                    : 'bg-muted w-4',
              )}
            />
          ))}
        </div>

        {/* Step counter */}
        <p className="text-muted-foreground mb-6 text-center text-xs">
          {tt('onboarding.stepOf', {
            current: step + 1,
            total: TOTAL_STEPS,
          })}
        </p>

        {/* Step Content with animation */}
        <div className="relative min-h-105">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: direction * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -40 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation Footer */}
        <div className="border-border mt-8 border-t pt-6">
          <div className="flex items-center justify-between">
            {step > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
              >
                <ArrowLeft className="size-4" />
                {ob.back}
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              {step < TOTAL_STEPS - 1 && step > 0 && (
                <button
                  type="button"
                  onClick={goNext}
                  className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                >
                  {ob.skip}
                </button>
              )}

              {step < TOTAL_STEPS - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
                >
                  {ob.next}
                  <ArrowRight className="size-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleComplete}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
                >
                  {ob.getStarted}
                  <ArrowRight className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
