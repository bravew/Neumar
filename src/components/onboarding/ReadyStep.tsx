/**
 * Onboarding Step 5: All Set
 *
 * Summary of configured profile, theme, providers, and local models.
 */

import { useEffect, useRef, useState } from 'react';

import { motion } from 'motion/react';

import { providerSvgIcons } from '@/components/settings/constants';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { API_BASE_URL } from '@/config';
import type { Settings } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// Types
// ============================================================================

interface SpeechLocalStatus {
  stt: { state: string };
  tts: {
    kokoro: { state: string };
    pocket: { state: string };
    kitten: { state: string };
  };
}

interface MemoryModelStatus {
  state: string;
}

// ============================================================================
// Animated Check Circle
// ============================================================================

function AnimatedCheckCircle() {
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
      className="bg-primary/10 flex size-16 items-center justify-center rounded-full"
    >
      <svg
        viewBox="0 0 24 24"
        className="text-primary size-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Circle — draws in */}
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
        />
        {/* Check mark — draws in after circle */}
        <motion.path
          d="M8 12.5l2.5 3 5.5-6"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.6, ease: 'easeOut' }}
        />
      </svg>
    </motion.div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

const MODEL_LABELS: Record<string, string> = {
  stt: 'Speech-to-Text',
  kokoro: 'Text-to-Speech',
  memory: 'Memory Embeddings',
};

function getReadyModels(
  speech: SpeechLocalStatus | null,
  memory: MemoryModelStatus | null,
): string[] {
  const ready: string[] = [];
  if (speech?.stt?.state === 'ready') ready.push(MODEL_LABELS.stt);
  if (speech?.tts?.kokoro?.state === 'ready') ready.push(MODEL_LABELS.kokoro);
  if (memory?.state === 'ready') ready.push(MODEL_LABELS.memory);
  return ready;
}

// ============================================================================
// Component
// ============================================================================

interface ReadyStepProps {
  settings: Settings;
}

export function ReadyStep({ settings }: ReadyStepProps) {
  const { t } = useLanguage();
  const ob = t.onboarding;
  const [speechStatus, setSpeechStatus] = useState<SpeechLocalStatus | null>(
    null,
  );
  const [memoryStatus, setMemoryStatus] = useState<MemoryModelStatus | null>(
    null,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    async function fetchStatuses() {
      try {
        const [speechRes, memRes] = await Promise.all([
          fetch(`${API_BASE_URL}/speech/local/status`, {
            signal: controller.signal,
          }).catch(() => null),
          fetch(`${API_BASE_URL}/memory/model/status`, {
            signal: controller.signal,
          }).catch(() => null),
        ]);
        if (!mountedRef.current) return;
        if (speechRes?.ok) setSpeechStatus(await speechRes.json());
        if (memRes?.ok) setMemoryStatus(await memRes.json());
      } catch {
        /* endpoints may not be available */
      }
    }
    fetchStatuses();
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  // Connected providers: have API key OR are Ollama with enabled status
  const connectedProviders = settings.providers.filter(
    (p) =>
      (p.id === 'ollama' && p.enabled) ||
      (p.id !== 'ollama' && p.id !== 'elevenlabs' && !!p.apiKey),
  );

  const readyModels = getReadyModels(speechStatus, memoryStatus);

  return (
    <div className="flex flex-col items-center">
      <AnimatedCheckCircle />

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.3 }}
        className="text-foreground mt-6 text-3xl font-bold"
      >
        {ob.readyTitle}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.3 }}
        className="text-muted-foreground mt-3 text-center text-base"
      >
        {ob.readySubtitle}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.35 }}
        className="border-border mt-8 w-full max-w-sm divide-y rounded-xl border"
      >
        {/* Profile */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-muted-foreground text-sm">
            {ob.readySummaryProfile}
          </span>
          <span className="text-foreground text-sm font-medium">
            {settings.profile.nickname || '—'}
          </span>
        </div>

        {/* Theme */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-muted-foreground text-sm">
            {ob.readySummaryTheme}
          </span>
          <span className="text-foreground text-sm font-medium">
            {settings.theme === 'light'
              ? ob.light
              : settings.theme === 'dark'
                ? ob.dark
                : ob.system}
          </span>
        </div>

        {/* AI Providers */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-muted-foreground text-sm">
            {ob.readySummaryProviders}
          </span>
          {connectedProviders.length > 0 ? (
            <TooltipProvider delayDuration={0}>
              <div className="flex items-center gap-1.5">
                {connectedProviders.map((p) => (
                  <Tooltip key={p.id}>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          'bg-muted text-foreground flex size-7 items-center justify-center rounded-md p-1.5',
                          'hover:bg-accent transition-colors',
                        )}
                      >
                        {providerSvgIcons[p.id] ||
                          p.icon ||
                          p.name.charAt(0).toUpperCase()}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{p.name}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          ) : (
            <span className="text-muted-foreground text-sm italic">
              {ob.readyNoneConfigured}
            </span>
          )}
        </div>

        {/* Local Models */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-muted-foreground text-sm">
            {ob.readySummaryModels}
          </span>
          <span className="text-foreground text-right text-sm font-medium">
            {readyModels.length > 0
              ? readyModels.join(', ')
              : ob.readyNoneDownloaded}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
