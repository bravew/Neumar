import { Loader2, Play, Square } from 'lucide-react';

import type { TtsTestState } from './hooks/useTtsTest';

const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

interface TtsTestPanelProps {
  ttsTestText: string;
  onTextChange: (text: string) => void;
  ttsTestState: TtsTestState;
  ttsTestError: string;
  onTest: () => void;
  onStop: () => void;
}

export function TtsTestPanel({
  ttsTestText,
  onTextChange,
  ttsTestState,
  ttsTestError,
  onTest,
  onStop,
}: TtsTestPanelProps) {
  return (
    <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
      <p className="text-foreground text-sm font-medium">Test</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={ttsTestText}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Enter text to synthesize..."
          className={INPUT_CLASS}
          aria-label="TTS test text"
        />
        {ttsTestState === 'playing' ? (
          <button
            type="button"
            onClick={onStop}
            className="bg-destructive hover:bg-destructive/90 inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white"
            aria-label="Stop playback"
          >
            <Square size={14} /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onTest}
            disabled={ttsTestState === 'loading' || !ttsTestText.trim()}
            className="bg-primary hover:bg-primary/90 inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            aria-label="Play TTS test"
          >
            {ttsTestState === 'loading' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            {ttsTestState === 'loading' ? 'Synthesizing...' : 'Play'}
          </button>
        )}
      </div>
      {ttsTestState === 'error' && ttsTestError && (
        <p className="text-sm text-red-600 dark:text-red-400">{ttsTestError}</p>
      )}
    </div>
  );
}
