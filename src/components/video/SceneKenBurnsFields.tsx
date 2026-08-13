import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAssetPlan } from '@/shared/types/video';

export function KenBurnsFields({
  plan,
  onChange,
}: {
  plan: Extract<VideoAssetPlan, { kind: 'image-pan' }>;
  onChange: (assetPlan: VideoAssetPlan) => void;
}) {
  const { t } = useLanguage();
  const from = plan.kenBurns?.from ?? { x: 0, y: 0, width: 1, height: 1 };
  const to = plan.kenBurns?.to ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  const updateRect = (
    key: 'from' | 'to',
    field: 'x' | 'y' | 'width' | 'height',
    value: number,
  ) => {
    onChange({
      ...plan,
      kenBurns: {
        from,
        to,
        [key]: { ...(key === 'from' ? from : to), [field]: value },
      },
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        {t.video.editor.inspector.plan.imagePan.kenBurns.label}
      </p>
      <RectFields
        label={t.video.editor.inspector.plan.imagePan.kenBurns.from.label}
        rect={from}
        onChange={(field, value) => updateRect('from', field, value)}
      />
      <RectFields
        label={t.video.editor.inspector.plan.imagePan.kenBurns.to.label}
        rect={to}
        onChange={(field, value) => updateRect('to', field, value)}
      />
    </div>
  );
}

function RectFields({
  label,
  rect,
  onChange,
}: {
  label: string;
  rect: { x: number; y: number; width: number; height: number };
  onChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <fieldset className="border-border rounded-md border p-2">
      <legend className="text-muted-foreground px-1 text-xs">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map((field) => (
          <label
            key={field}
            className="text-muted-foreground space-y-1 text-xs"
          >
            <span>
              {t.video.editor.inspector.plan.imagePan.kenBurns[field]}
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={rect[field]}
              onChange={(event) => onChange(field, Number(event.target.value))}
              className="border-input bg-background text-foreground w-full rounded-md border px-2 py-1"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
