import { RefreshCw } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAssetPlan, VideoProject } from '@/shared/types/video';

interface SceneLipsyncPlanFieldsProps {
  plan: Extract<VideoAssetPlan, { kind: 'lipsync' }>;
  imageAssets: VideoProject['assets'];
  sceneDurationMs: number;
  busy: boolean;
  onChange: (assetPlan: VideoAssetPlan) => void;
  onGeneratePreview: () => void;
}

const LIPSYNC_PROVIDERS: NonNullable<
  Extract<VideoAssetPlan, { kind: 'lipsync' }>['lipsyncProvider']
>[] = [
  'auto',
  'hedra',
  'omnihuman',
  'pika',
  'heygen',
  'veed-fabric',
  'synthesia',
];

export function SceneLipsyncPlanFields({
  plan,
  imageAssets,
  sceneDurationMs,
  busy,
  onChange,
  onGeneratePreview,
}: SceneLipsyncPlanFieldsProps) {
  const { t } = useLanguage();
  const disabled =
    busy ||
    !plan.text.trim() ||
    !plan.referenceImageAssetId ||
    plan.egressConfirmed !== true;

  return (
    <div className="space-y-2">
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.plan.lipsync.text}</span>
        <textarea
          value={plan.text}
          onChange={(event) => onChange({ ...plan, text: event.target.value })}
          className="border-input bg-background text-foreground min-h-20 w-full rounded-md border px-3 py-2"
        />
      </label>
      <ReferenceSelect
        label={t.video.editor.inspector.plan.lipsync.referenceImage}
        value={plan.referenceImageAssetId}
        imageAssets={imageAssets}
        onChange={(referenceImageAssetId) =>
          onChange({ ...plan, referenceImageAssetId, egressConfirmed: false })
        }
      />
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.plan.lipsync.provider}</span>
        <select
          value={plan.lipsyncProvider ?? 'auto'}
          onChange={(event) =>
            onChange({
              ...plan,
              lipsyncProvider: event.target.value as NonNullable<
                typeof plan.lipsyncProvider
              >,
            })
          }
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        >
          {LIPSYNC_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {providerLabel(t, provider)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.plan.lipsync.voice}</span>
        <input
          value={plan.voiceId ?? ''}
          onChange={(event) =>
            onChange({ ...plan, voiceId: event.target.value || undefined })
          }
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        />
      </label>
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.plan.lipsync.motionScale}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={plan.motionScale ?? 0.5}
          onChange={(event) =>
            onChange({ ...plan, motionScale: Number(event.target.value) })
          }
          className="w-full"
        />
      </label>
      <BackgroundFields
        plan={plan}
        imageAssets={imageAssets}
        onChange={onChange}
      />
      <div className="border-border bg-muted/20 space-y-2 rounded-md border p-2">
        <p className="text-muted-foreground text-xs">
          {t.video.editor.inspector.scene.referenceUploadNotice}
        </p>
        <label className="text-muted-foreground flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={plan.egressConfirmed === true}
            onChange={(event) =>
              onChange({ ...plan, egressConfirmed: event.target.checked })
            }
            className="mt-0.5"
          />
          <span>{t.video.editor.inspector.scene.referenceUploadConfirm}</span>
        </label>
      </div>
      <p className="text-muted-foreground text-xs">
        {t.video.editor.lipsync.cost.estimate.replace(
          '{seconds}',
          String(Math.max(1, Math.ceil(sceneDurationMs / 1000))),
        )}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onGeneratePreview}
        className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
      >
        <RefreshCw className="mr-1 inline size-3" />
        {t.video.editor.inspector.plan.lipsync.generatePreview}
      </button>
    </div>
  );
}

function BackgroundFields({
  plan,
  imageAssets,
  onChange,
}: {
  plan: Extract<VideoAssetPlan, { kind: 'lipsync' }>;
  imageAssets: VideoProject['assets'];
  onChange: (assetPlan: VideoAssetPlan) => void;
}) {
  const { t } = useLanguage();
  const kind = plan.background?.kind ?? 'transparent';
  return (
    <div className="grid gap-2">
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.plan.lipsync.background.label}</span>
        <select
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value;
            if (nextKind === 'color')
              onChange({
                ...plan,
                background: { kind: 'color', color: '#000000' },
              });
            else if (nextKind === 'image')
              onChange({
                ...plan,
                background: {
                  kind: 'image',
                  assetId: imageAssets[0]?.id ?? '',
                },
              });
            else onChange({ ...plan, background: { kind: 'transparent' } });
          }}
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        >
          <option value="transparent">
            {t.video.editor.inspector.plan.lipsync.background.transparent}
          </option>
          <option value="color">
            {t.video.editor.inspector.plan.lipsync.background.color}
          </option>
          <option value="image">
            {t.video.editor.inspector.plan.lipsync.background.image}
          </option>
        </select>
      </label>
      {plan.background?.kind === 'color' ? (
        <input
          type="color"
          value={plan.background.color ?? '#000000'}
          onChange={(event) =>
            onChange({
              ...plan,
              background: { kind: 'color', color: event.target.value },
            })
          }
          className="h-9 w-full"
        />
      ) : null}
      {plan.background?.kind === 'image' ? (
        <ReferenceSelect
          label={t.video.editor.inspector.plan.lipsync.background.image}
          value={plan.background.assetId}
          imageAssets={imageAssets}
          onChange={(assetId) =>
            onChange({ ...plan, background: { kind: 'image', assetId } })
          }
        />
      ) : null}
    </div>
  );
}

function ReferenceSelect({
  label,
  value,
  imageAssets,
  onChange,
}: {
  label: string;
  value?: string;
  imageAssets: VideoProject['assets'];
  onChange: (assetId: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <label className="text-muted-foreground block space-y-1 text-xs">
      <span>{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
      >
        <option value="">{t.video.editor.inspector.scene.referenceNone}</option>
        {imageAssets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.path}
          </option>
        ))}
      </select>
    </label>
  );
}

function providerLabel(
  t: ReturnType<typeof useLanguage>['t'],
  provider: NonNullable<
    Extract<VideoAssetPlan, { kind: 'lipsync' }>['lipsyncProvider']
  >,
): string {
  if (provider === 'veed-fabric')
    return t.video.editor.lipsync.provider.veedFabric;
  return t.video.editor.lipsync.provider[provider];
}
