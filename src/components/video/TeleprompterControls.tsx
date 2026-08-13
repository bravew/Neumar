import { Pause, Play, RotateCcw } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

interface TeleprompterControlsProps {
  running: boolean;
  wpm: number;
  fontSize: number;
  mirror: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onWpmChange: (value: number) => void;
  onFontSizeChange: (value: number) => void;
  onMirrorChange: (value: boolean) => void;
}

export function TeleprompterControls({
  running,
  wpm,
  fontSize,
  mirror,
  onStart,
  onPause,
  onReset,
  onWpmChange,
  onFontSizeChange,
  onMirrorChange,
}: TeleprompterControlsProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.capture.teleprompter;
  return (
    <div className="border-border bg-background/95 flex flex-wrap items-center gap-3 border-t px-4 py-3 text-sm">
      <button
        type="button"
        onClick={running ? onPause : onStart}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm"
      >
        {running ? <Pause className="size-4" /> : <Play className="size-4" />}
        {running ? labels.pause : labels.start}
      </button>
      <button
        type="button"
        onClick={onReset}
        className="border-border hover:bg-accent inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
      >
        <RotateCcw className="size-4" />
        {labels.reset}
      </button>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">{labels.wpm}</span>
        <input
          type="number"
          min={80}
          max={250}
          value={wpm}
          onChange={(event) => onWpmChange(Number(event.target.value))}
          className="border-input bg-background h-9 w-20 rounded-md border px-2"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">{labels.fontSize}</span>
        <input
          type="number"
          min={24}
          max={96}
          value={fontSize}
          onChange={(event) => onFontSizeChange(Number(event.target.value))}
          className="border-input bg-background h-9 w-20 rounded-md border px-2"
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={mirror}
          onChange={(event) => onMirrorChange(event.target.checked)}
        />
        {labels.mirror}
      </label>
    </div>
  );
}
