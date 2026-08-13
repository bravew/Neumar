import { RefreshCw, Shuffle } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAssetPlan, VideoProject } from '@/shared/types/video';

interface AiImagePlanFieldsProps {
  plan: Extract<VideoAssetPlan, { kind: 'ai-image' }>;
  imageAssets: VideoProject['assets'];
  busy: boolean;
  onChange: (assetPlan: VideoAssetPlan) => void;
  onUploadReferenceImages: (files: FileList | null) => void;
  onGenerateNow: () => void;
}

export function AiImagePlanFields({
  plan,
  imageAssets,
  busy,
  onChange,
  onUploadReferenceImages,
  onGenerateNow,
}: AiImagePlanFieldsProps) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.plan.aiImage.refImages.label}</span>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(event) => onUploadReferenceImages(event.target.files)}
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        />
      </label>
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.scene.referenceImage}</span>
        <select
          multiple
          value={plan.refImageIds ?? []}
          onChange={(event) =>
            onChange({
              ...plan,
              refImageIds: Array.from(event.target.selectedOptions)
                .map((option) => option.value)
                .filter(Boolean),
            })
          }
          className="border-input bg-background text-foreground min-h-24 w-full rounded-md border px-3 py-2"
        >
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.path}
            </option>
          ))}
        </select>
      </label>
      <ProviderField plan={plan} onChange={onChange} />
      <SeedField plan={plan} onChange={onChange} />
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.plan.aiImage.size.label}</span>
        <select
          value={plan.size ?? '2K'}
          onChange={(event) => onChange({ ...plan, size: event.target.value })}
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        >
          <option value="2K">2K</option>
          <option value="4K">4K</option>
          <option value="1024x1024">1024x1024</option>
          <option value="1920x1080">1920x1080</option>
          <option value="1080x1920">1080x1920</option>
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !plan.prompt.trim()}
        onClick={onGenerateNow}
        className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
      >
        {t.video.editor.inspector.plan.generateNow}
      </button>
    </div>
  );
}

interface AiClipPlanFieldsProps {
  plan: Extract<VideoAssetPlan, { kind: 'ai-clip' }>;
  imageAssets: VideoProject['assets'];
  sceneDurationMs: number;
  onChange: (assetPlan: VideoAssetPlan) => void;
}

export function AiClipPlanFields({
  plan,
  imageAssets,
  sceneDurationMs,
  onChange,
}: AiClipPlanFieldsProps) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      <ReferenceSelect
        label={t.video.editor.inspector.scene.referenceImage}
        value={plan.refImageId}
        imageAssets={imageAssets}
        onChange={(refImageId) => onChange({ ...plan, refImageId })}
      />
      <ReferenceSelect
        label={t.video.editor.inspector.scene.referenceImageTail}
        value={plan.refImageTailId}
        imageAssets={imageAssets}
        onChange={(refImageTailId) => onChange({ ...plan, refImageTailId })}
      />
      <ProviderField plan={plan} onChange={onChange} />
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.editor.inspector.scene.durationMs}</span>
        <input
          type="number"
          min={1000}
          step={500}
          value={plan.durationMs ?? sceneDurationMs}
          onChange={(event) =>
            onChange({ ...plan, durationMs: Number(event.target.value) })
          }
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        />
      </label>
      <SeedField plan={plan} onChange={onChange} />
    </div>
  );
}

export function RegenerateSceneControls({
  plan,
  busy,
  hasReferenceImages,
  referenceUploadConfirmed,
  onReferenceUploadConfirmedChange,
  onRegenerate,
}: {
  plan: Extract<VideoAssetPlan, { kind: 'ai-image' | 'ai-clip' }>;
  busy: boolean;
  hasReferenceImages: boolean;
  referenceUploadConfirmed: boolean;
  onReferenceUploadConfirmedChange: (confirmed: boolean) => void;
  onRegenerate: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      {hasReferenceImages ? (
        <div className="border-border bg-muted/20 space-y-2 rounded-md border p-2">
          <p className="text-muted-foreground text-xs">
            {t.video.editor.inspector.scene.referenceUploadNotice}
          </p>
          <label className="text-muted-foreground flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={referenceUploadConfirmed}
              onChange={(event) =>
                onReferenceUploadConfirmedChange(event.target.checked)
              }
              className="mt-0.5"
            />
            <span>{t.video.editor.inspector.scene.referenceUploadConfirm}</span>
          </label>
        </div>
      ) : null}
      <button
        type="button"
        disabled={
          busy ||
          !plan.prompt.trim() ||
          (hasReferenceImages && !referenceUploadConfirmed)
        }
        onClick={onRegenerate}
        className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-md px-3 py-2 text-xs font-medium disabled:opacity-60"
      >
        <RefreshCw className="mr-1 inline size-3" />
        {t.video.editor.inspector.scene.regenerate}
      </button>
    </div>
  );
}

function ProviderField({
  plan,
  onChange,
}: {
  plan: Extract<VideoAssetPlan, { kind: 'ai-image' | 'ai-clip' }>;
  onChange: (assetPlan: VideoAssetPlan) => void;
}) {
  const { t } = useLanguage();
  return (
    <label className="text-muted-foreground block space-y-1 text-xs">
      <span>{t.video.editor.inspector.plan.aiImage.provider.label}</span>
      <input
        value={plan.provider ?? ''}
        onChange={(event) =>
          onChange({ ...plan, provider: event.target.value || undefined })
        }
        className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
      />
    </label>
  );
}

function SeedField({
  plan,
  onChange,
}: {
  plan: Extract<VideoAssetPlan, { kind: 'ai-image' | 'ai-clip' }>;
  onChange: (assetPlan: VideoAssetPlan) => void;
}) {
  const { t } = useLanguage();
  const updateSeed = (seed: number | undefined) => {
    onChange({ ...plan, seed });
  };
  return (
    <label className="text-muted-foreground block space-y-1 text-xs">
      <span>{t.video.editor.inspector.scene.seed.label}</span>
      <div className="flex gap-2">
        <input
          type="number"
          step={1}
          value={plan.seed ?? ''}
          onChange={(event) =>
            updateSeed(
              event.target.value === ''
                ? undefined
                : Number(event.target.value),
            )
          }
          className="border-input bg-background text-foreground min-w-0 flex-1 rounded-md border px-3 py-2"
        />
        <button
          type="button"
          className="border-border hover:bg-accent rounded-md border px-2 py-1"
          onClick={() => updateSeed(Math.floor(Math.random() * 2_147_483_647))}
        >
          <Shuffle className="mr-1 inline size-3" />
          {t.video.editor.inspector.scene.seed.random}
        </button>
      </div>
    </label>
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
  onChange: (assetId: string | undefined) => void;
}) {
  const { t } = useLanguage();
  return (
    <label className="text-muted-foreground block space-y-1 text-xs">
      <span>{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
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
