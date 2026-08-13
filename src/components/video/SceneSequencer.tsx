import { useMemo } from 'react';

import {
  Captions,
  Image as ImageIcon,
  Loader2,
  Music,
  Plus,
  Video,
  Volume2,
} from 'lucide-react';

import { projectAssetThumbnailUrl } from '@/components/video/assets/projectAssetMedia';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoStoryboardScene } from '@/shared/types/video';
import { videoTransitionKind } from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';
import { resolveTemplatePosterUrl } from '@/shared/video/templatePreview';
import {
  type GalleryTemplateSummary,
  useHtmlGallery,
} from '@/shared/video/useHtmlGallery';

interface SceneSequencerProps {
  project: VideoProject;
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  onUpdateStoryboard: (scenes: VideoStoryboardScene[]) => Promise<void>;
  regeneratingSceneIds?: Set<string>;
}

export function SceneSequencer({
  project,
  selectedSceneId,
  onSelectScene,
  onUpdateStoryboard,
  regeneratingSceneIds,
}: SceneSequencerProps) {
  const { t } = useLanguage();
  const storyboard = project.storyboard;
  const scenes = storyboard?.scenes ?? [];
  const { templates } = useHtmlGallery();
  const templatesById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );

  const addScene = async () => {
    if (!storyboard) return;

    const asset = project.assets[0];
    const next: VideoStoryboardScene = {
      id: randomUUID(),
      durationMs: 4000,
      intent: t.video.storyboard.newSceneIntent,
      caption: { text: t.video.storyboard.newSceneIntent },
      transition: 'cut',
      assetPlan: asset
        ? { kind: 'existing', assetId: asset.id }
        : {
            kind: 'ai-clip',
            prompt: t.video.storyboard.newSceneIntent,
            aspectRatio: '16:9',
            durationMs: 4000,
            provider: 'seedance-2-0-fast',
          },
    };

    await onUpdateStoryboard([...scenes, next]);
    onSelectScene(next.id);
  };

  if (!storyboard) {
    return (
      <div className="border-border bg-muted/20 flex min-h-48 items-center justify-center rounded-md border border-dashed">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Video className="size-4" />
          <span>{t.video.editor.sequencer.empty}</span>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {t.video.editor.sequencer.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {t.video.storyboard.summary
              .replace('{count}', String(scenes.length))
              .replace(
                '{seconds}',
                String(Math.round(storyboard.totalDurationMs / 1000)),
              )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void addScene()}
          className="border-border hover:bg-accent rounded-md border px-3 py-2 text-xs"
        >
          <Plus className="mr-1 inline size-3" />
          {t.video.storyboard.addScene}
        </button>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-2">
          {scenes.map((scene, index) => {
            const regenerating = regeneratingSceneIds?.has(scene.id) ?? false;
            const htmlTemplateId =
              scene.htmlFrameSeed?.renderOverride?.templateId ??
              scene.htmlFrameSeed?.templateId;
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => onSelectScene(scene.id)}
                className={cn(
                  'text-foreground w-56 rounded-md border p-2 text-left transition',
                  selectedSceneId === scene.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-accent/60 bg-background',
                )}
              >
                <ScenePreviewThumb
                  project={project}
                  scene={scene}
                  template={
                    htmlTemplateId
                      ? templatesById.get(htmlTemplateId)
                      : undefined
                  }
                  planLabel={assetPlanLabel(
                    scene,
                    t.video.editor.inspector.plan,
                  )}
                  pendingLabel={t.video.preview.placeholder}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {t.video.storyboard.sceneLabel.replace(
                      '{index}',
                      String(index + 1),
                    )}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
                    {regenerating ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        {t.video.editor.scene.regenerating}
                      </>
                    ) : (
                      `${Math.round(scene.durationMs / 1000)}s`
                    )}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs">{scene.intent}</p>
                <div className="text-muted-foreground mt-3 flex items-center justify-between text-[11px]">
                  <span>
                    {assetPlanLabel(scene, t.video.editor.inspector.plan)}
                  </span>
                  <span>{videoTransitionKind(scene.transition)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="text-muted-foreground grid min-w-max grid-cols-[96px_1fr] gap-x-2 gap-y-1 text-[11px]">
          <div className="flex items-center gap-1.5 py-1">
            <Video className="size-3" />
            {t.video.editor.lane.video}
          </div>
          <div className="flex gap-2">
            {scenes.map((scene) => (
              <div
                key={scene.id}
                className="bg-muted/40 h-6 w-56 rounded-sm border border-transparent"
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5 py-1">
            <Volume2 className="size-3" />
            {t.video.editor.lane.narration}
          </div>
          <div className="flex gap-2">
            {scenes.map((scene) => {
              const segment = storyboard.narration?.segments.find(
                (entry) => entry.sceneId === scene.id,
              );
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => onSelectScene(scene.id)}
                  className="border-border bg-background hover:bg-accent h-6 w-56 truncate rounded-sm border px-2 text-left"
                >
                  {segment?.text ?? scene.caption?.text ?? scene.intent}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 py-1">
            <Music className="size-3" />
            {t.video.editor.lane.music}
          </div>
          <div>
            {storyboard.music ? (
              <div className="border-border bg-primary/10 text-foreground h-6 max-w-[720px] truncate rounded-sm border px-2 py-1">
                {t.video.editor.sequencer.musicTrack.replace(
                  '{prompt}',
                  storyboard.music.prompt,
                )}
              </div>
            ) : (
              <div className="border-border bg-muted/20 h-6 max-w-[720px] rounded-sm border border-dashed" />
            )}
          </div>
          <div className="flex items-center gap-1.5 py-1">
            <Captions className="size-3" />
            {t.video.editor.lane.captions}
          </div>
          <div className="flex gap-2">
            {scenes.map((scene) => (
              <button
                key={scene.id}
                type="button"
                onClick={() => onSelectScene(scene.id)}
                className="border-border bg-background hover:bg-accent h-6 w-56 truncate rounded-sm border px-2 text-left"
              >
                {scene.caption?.text ?? ''}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScenePreviewThumb({
  project,
  scene,
  template,
  planLabel,
  pendingLabel,
}: {
  project: VideoProject;
  scene: VideoStoryboardScene;
  template?: GalleryTemplateSummary;
  planLabel: string;
  pendingLabel: string;
}) {
  const templatePosterUrl = resolveTemplatePosterUrl(
    template?.preview?.posterUrl,
  );
  const templateLabel =
    template?.metadata.name ?? scene.htmlFrameSeed?.templateId ?? planLabel;
  const asset = resolveSceneAsset(project, scene);
  const assetPosterUrl = asset
    ? projectAssetThumbnailUrl(project.id, asset)
    : '';
  const posterUrl = templatePosterUrl || assetPosterUrl;
  const label = scene.htmlFrameSeed ? templateLabel : planLabel;

  return (
    <div className="bg-muted/70 border-border/80 relative mb-2 aspect-video overflow-hidden rounded border">
      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
          {scene.assetPlan.kind === 'ai-image' ? (
            <ImageIcon className="size-4" />
          ) : (
            <Video className="size-4" />
          )}
          <span className="line-clamp-1 text-[11px] font-medium">{label}</span>
          <span className="line-clamp-1 text-[10px]">{pendingLabel}</span>
        </div>
      )}
      <span className="bg-background/85 text-muted-foreground absolute top-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded px-1.5 py-0.5 text-[10px] font-medium backdrop-blur">
        {label}
      </span>
    </div>
  );
}

function resolveSceneAsset(
  project: VideoProject,
  scene: VideoStoryboardScene,
): VideoProject['assets'][number] | undefined {
  const assetId =
    scene.assetPlan.kind === 'existing' || scene.assetPlan.kind === 'image-pan'
      ? scene.assetPlan.assetId
      : undefined;
  if (!assetId) return undefined;
  return project.assets.find((asset) => asset.id === assetId);
}

function assetPlanLabel(
  scene: VideoStoryboardScene,
  labels: ReturnType<
    typeof useLanguage
  >['t']['video']['editor']['inspector']['plan'],
) {
  switch (scene.assetPlan.kind) {
    case 'existing':
      return labels.existing.label;
    case 'ai-clip':
      return labels.aiClip.label;
    case 'ai-image':
      return labels.aiImage.label;
    case 'broll-search':
      return labels.brollSearch.label;
    case 'image-pan':
      return labels.imagePan.label;
    case 'tts-narration':
      return labels.ttsNarration.label;
    case 'lipsync':
      return labels.lipsync.label;
  }
}
