import { useLanguage } from '@/shared/providers/language-provider';

interface CaptureTeleprompterSettingsProps {
  wpm: number;
  mirror: boolean;
  fontSize: number;
  opacity: number;
  onWpmChange: (value: number) => void;
  onMirrorChange: (value: boolean) => void;
  onFontSizeChange: (value: number) => void;
  onOpacityChange: (value: number) => void;
}

export function CaptureTeleprompterSettings({
  wpm,
  mirror,
  fontSize,
  opacity,
  onWpmChange,
  onMirrorChange,
  onFontSizeChange,
  onOpacityChange,
}: CaptureTeleprompterSettingsProps) {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <label className="space-y-1">
        <span>{t.video.editor.capture.teleprompter.wpm}</span>
        <input
          type="number"
          min={80}
          max={250}
          value={wpm}
          onChange={(event) => onWpmChange(Number(event.target.value))}
          className="border-input bg-background w-full rounded-md border px-3 py-2"
        />
      </label>
      <label className="space-y-1">
        <span>{t.video.editor.capture.teleprompter.fontSize}</span>
        <input
          type="number"
          min={20}
          max={72}
          value={fontSize}
          onChange={(event) => onFontSizeChange(Number(event.target.value))}
          className="border-input bg-background w-full rounded-md border px-3 py-2"
        />
      </label>
      <label className="space-y-1">
        <span>{t.video.editor.capture.teleprompter.opacity}</span>
        <input
          type="range"
          min={30}
          max={100}
          value={opacity}
          onChange={(event) => onOpacityChange(Number(event.target.value))}
          className="w-full"
        />
      </label>
      <label className="flex items-center gap-2 pt-5">
        <input
          type="checkbox"
          checked={mirror}
          onChange={(event) => onMirrorChange(event.target.checked)}
        />
        {t.video.editor.capture.teleprompter.mirror}
      </label>
    </div>
  );
}
