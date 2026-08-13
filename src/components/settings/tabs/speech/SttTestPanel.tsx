import { Loader2, Mic, MicOff } from 'lucide-react';

import type { SttTestState } from './hooks/useSttTest';

interface SttTestPanelProps {
  sttTestState: SttTestState;
  sttTestTranscript: string;
  sttTestPartial: string;
  sttTestError: string;
  sttTestDuration: number;
  onStart: () => void;
  onStop: () => void;
}

export function SttTestPanel({
  sttTestState,
  sttTestTranscript,
  sttTestPartial,
  sttTestError,
  sttTestDuration,
  onStart,
  onStop,
}: SttTestPanelProps) {
  return (
    <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
      <p className="text-foreground text-sm font-medium">Test</p>
      <div className="flex items-center gap-3">
        {sttTestState === 'recording' ? (
          <button
            type="button"
            onClick={onStop}
            className="bg-destructive hover:bg-destructive/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white"
            aria-label="Stop recording"
          >
            <MicOff size={14} />
            Stop ({sttTestDuration}s)
          </button>
        ) : sttTestState === 'transcribing' ? (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white opacity-80"
            aria-label="Transcribing"
          >
            <Loader2 size={14} className="animate-spin" />
            Transcribing...
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="bg-primary hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white"
            aria-label="Start recording"
          >
            <Mic size={14} />
            Record
          </button>
        )}
        {sttTestPartial && (
          <p className="text-muted-foreground text-sm italic">
            {sttTestPartial}
          </p>
        )}
      </div>
      {sttTestTranscript && (
        <div className="bg-background rounded-md border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Transcript:
          </p>
          <p className="text-foreground text-sm">{sttTestTranscript}</p>
        </div>
      )}
      {sttTestState === 'error' && sttTestError && (
        <p className="text-sm text-red-600 dark:text-red-400">{sttTestError}</p>
      )}
    </div>
  );
}
