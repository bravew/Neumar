import { ExternalLink, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { CaptureTeleprompterSettings } from './CaptureTeleprompterSettings';

interface CaptureTeleprompterPanelProps {
  promptText: string;
  wpm: number;
  mirror: boolean;
  fontSize: number;
  opacity: number;
  teleprompterOpen: boolean;
  onWpmChange: (value: number) => void;
  onMirrorChange: (value: boolean) => void;
  onFontSizeChange: (value: number) => void;
  onOpacityChange: (value: number) => void;
  onOpenTeleprompter: () => void;
  onCloseTeleprompter: () => void;
}

export function CaptureTeleprompterPanel({
  promptText,
  wpm,
  mirror,
  fontSize,
  opacity,
  teleprompterOpen,
  onWpmChange,
  onMirrorChange,
  onFontSizeChange,
  onOpacityChange,
  onOpenTeleprompter,
  onCloseTeleprompter,
}: CaptureTeleprompterPanelProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.capture.teleprompter;
  return (
    <div className="space-y-3">
      <div
        className="bg-muted text-foreground flex min-h-44 items-center justify-center rounded-md p-6 text-center"
        style={{
          opacity: opacity / 100,
          transform: mirror ? 'scaleX(-1)' : undefined,
          fontSize,
          lineHeight: 1.35,
        }}
      >
        {promptText}
      </div>
      <CaptureTeleprompterSettings
        wpm={wpm}
        mirror={mirror}
        fontSize={fontSize}
        opacity={opacity}
        onWpmChange={onWpmChange}
        onMirrorChange={onMirrorChange}
        onFontSizeChange={onFontSizeChange}
        onOpacityChange={onOpacityChange}
      />
      <div className="flex justify-end">
        {teleprompterOpen ? (
          <button
            type="button"
            onClick={onCloseTeleprompter}
            className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
          >
            <X className="size-3" />
            {labels.closeWindow}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenTeleprompter}
            className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
          >
            <ExternalLink className="size-3" />
            {labels.openWindow}
          </button>
        )}
      </div>
    </div>
  );
}
