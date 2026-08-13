/**
 * Onboarding Step 4: Local Models
 *
 * Presents download controls for on-device STT, TTS, and embedding models.
 * All state (status, polling) is managed by the parent OnboardingPage so that
 * downloads continue in the background even after the user navigates away.
 */

import { useMemo } from 'react';

import { AlertCircle, Check, Download, Loader2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// Types (exported so OnboardingPage can share the same shapes)
// ============================================================================

export type LocalModelState =
  | 'not_downloaded'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'error';

export interface LocalModelStatusEntry {
  state: LocalModelState;
  downloadProgress?: { downloadedBytes: number; totalBytes: number };
  progress?: { downloadedBytes: number; totalBytes: number };
  phase?: string;
  error?: string;
  message?: string;
}

export interface SpeechLocalStatus {
  stt: LocalModelStatusEntry;
  tts: {
    kokoro: LocalModelStatusEntry;
    pocket: LocalModelStatusEntry;
    kitten: LocalModelStatusEntry;
  };
}

// ============================================================================
// Helpers
// ============================================================================

export function isAnyModelInProgress(
  speech: SpeechLocalStatus | null,
  memory: LocalModelStatusEntry | null,
): boolean {
  const states: LocalModelState[] = [];
  if (speech) {
    states.push(
      speech.stt.state,
      speech.tts.kokoro.state,
      speech.tts.pocket.state,
      speech.tts.kitten.state,
    );
  }
  if (memory) states.push(memory.state);
  return states.some((s) => s === 'downloading' || s === 'loading');
}

// ============================================================================
// Props
// ============================================================================

export interface ModelsStepProps {
  speechStatus: SpeechLocalStatus | null;
  memoryStatus: LocalModelStatusEntry | null;
  onSpeechDownload: (model: string) => void;
  onMemoryDownload: () => void;
}

// ============================================================================
// Main Component
// ============================================================================

export function ModelsStep({
  speechStatus,
  memoryStatus,
  onSpeechDownload,
  onMemoryDownload,
}: ModelsStepProps) {
  const { t } = useLanguage();
  const ob = t.onboarding;

  const models = useMemo(
    () => [
      {
        id: 'stt',
        label: ob.sttModelLabel,
        description: ob.sttModelDescription,
        status: speechStatus?.stt,
        onDownload: () => onSpeechDownload('stt'),
      },
      {
        id: 'kokoro',
        label: ob.ttsModelLabel,
        description: ob.ttsModelDescription,
        status: speechStatus?.tts?.kokoro,
        onDownload: () => onSpeechDownload('kokoro'),
      },
      {
        id: 'memory',
        label: ob.embeddingModelLabel,
        description: ob.embeddingModelDescription,
        status: memoryStatus ?? undefined,
        onDownload: onMemoryDownload,
      },
    ],
    [ob, speechStatus, memoryStatus, onSpeechDownload, onMemoryDownload],
  );

  return (
    <div>
      <h1 className="text-foreground text-center text-3xl font-bold">
        {ob.modelsTitle}
      </h1>
      <p className="text-muted-foreground mt-3 text-center text-base">
        {ob.modelsSubtitle}
      </p>

      <div className="mt-8 space-y-3">
        {models.map((model) => (
          <ModelCard key={model.id} {...model} />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// ModelCard
// ============================================================================

interface ModelCardProps {
  id: string;
  label: string;
  description: string;
  status: LocalModelStatusEntry | undefined;
  onDownload: () => void;
}

function ModelCard({ label, description, status, onDownload }: ModelCardProps) {
  const { t } = useLanguage();
  const ob = t.onboarding;
  const state = status?.state ?? 'not_downloaded';
  const progress = status?.downloadProgress ?? status?.progress;

  return (
    <div className="border-border flex items-center gap-4 rounded-xl border p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{label}</span>
          <span className="text-muted-foreground rounded bg-gray-500/10 px-1.5 py-0.5 text-[10px] font-medium">
            {ob.modelOptional}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        {state === 'downloading' && progress && progress.totalBytes > 0 && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{
                width: `${Math.round((progress.downloadedBytes / progress.totalBytes) * 100)}%`,
              }}
            />
          </div>
        )}
      </div>

      <div className="shrink-0">
        {state === 'not_downloaded' && (
          <button
            type="button"
            onClick={onDownload}
            className="bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          >
            <Download className="size-3.5" />
            {ob.download}
          </button>
        )}
        {(state === 'downloading' || state === 'loading') && (
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            {ob.downloading}
          </div>
        )}
        {state === 'ready' && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <Check className="size-3.5" />
            {ob.downloaded}
          </div>
        )}
        {state === 'error' && (
          <button
            type="button"
            onClick={onDownload}
            className={cn(
              'flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium',
              'text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400',
            )}
          >
            <AlertCircle className="size-3.5" />
            {ob.retry}
          </button>
        )}
      </div>
    </div>
  );
}
