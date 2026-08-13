import { GripVertical, RefreshCw } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAssetPlan,
  VideoProject,
  VideoStoryboardScene,
} from '@/shared/types/video';
import {
  VIDEO_TRANSITION_REGISTRY,
  videoTransitionKind,
} from '@/shared/types/video';

const PLAN_KINDS: VideoAssetPlan['kind'][] = [
  'existing',
  'ai-image',
  'ai-clip',
  'broll-search',
  'image-pan',
  'tts-narration',
  'lipsync',
];

interface StoryboardSceneCardProps {
  scene: VideoStoryboardScene;
  index: number;
  project?: VideoProject;
  onChange: (patch: Partial<VideoStoryboardScene>) => void;
  onReplan: () => Promise<void>;
}

export function StoryboardSceneCard({
  scene,
  index,
  project,
  onChange,
  onReplan,
}: StoryboardSceneCardProps) {
  const { t } = useLanguage();
  const transitionLabels = t.video.storyboard.transitions as Record<
    string,
    string
  >;
  return (
    <section className="border-border bg-muted/20 space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GripVertical className="text-muted-foreground size-4" />
          <p className="text-foreground text-xs font-medium">
            {t.video.storyboard.sceneLabel.replace(
              '{index}',
              String(index + 1),
            )}
          </p>
        </div>
        <input
          type="number"
          min={500}
          step={500}
          value={scene.durationMs}
          onChange={(event) =>
            onChange({ durationMs: Number(event.target.value) })
          }
          className="border-input bg-background text-foreground w-24 rounded-md border px-2 py-1 text-xs"
        />
      </div>
      <textarea
        value={scene.intent}
        onChange={(event) => onChange({ intent: event.target.value })}
        className="border-input bg-background text-foreground min-h-16 w-full rounded-md border px-3 py-2 text-xs"
      />
      <AssetPlanEditor
        scene={scene}
        project={project}
        onChange={(assetPlan) => onChange({ assetPlan })}
      />
      <input
        value={scene.caption?.text ?? ''}
        onChange={(event) =>
          onChange({ caption: { ...scene.caption, text: event.target.value } })
        }
        placeholder={t.video.storyboard.caption}
        className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-xs"
      />
      <div className="flex items-center gap-2">
        <select
          value={videoTransitionKind(scene.transition)}
          onChange={(event) =>
            onChange({
              transition: event.target
                .value as VideoStoryboardScene['transition'],
            })
          }
          className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-xs"
        >
          {VIDEO_TRANSITION_REGISTRY.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {transitionLabels[transitionLabelId(entry.labelKey)] ??
                entry.kind}
              {transitionRenderNote(
                entry.native,
                t.video.editor.timeline.remotionOnly,
                t.video.editor.timeline.ffmpegOnly,
              )}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void onReplan()}
          className="border-border hover:bg-accent rounded-md border px-2 py-1 text-xs"
        >
          <RefreshCw className="mr-1 inline size-3" />
          {t.video.storyboard.replan}
        </button>
      </div>
    </section>
  );
}

function AssetPlanEditor({
  scene,
  project,
  onChange,
}: {
  scene: VideoStoryboardScene;
  project?: VideoProject;
  onChange: (assetPlan: VideoAssetPlan) => void;
}) {
  const { t } = useLanguage();
  const plan = scene.assetPlan;
  const firstAsset = project?.assets[0];
  const switchKind = (kind: VideoAssetPlan['kind']) => {
    onChange(defaultPlan(kind, scene, firstAsset?.id));
  };

  return (
    <div className="grid gap-2 md:grid-cols-[140px_1fr]">
      <select
        value={plan.kind}
        onChange={(event) =>
          switchKind(event.target.value as VideoAssetPlan['kind'])
        }
        className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-xs"
      >
        {PLAN_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      {plan.kind === 'existing' || plan.kind === 'image-pan' ? (
        <select
          value={plan.assetId}
          onChange={(event) =>
            onChange({ ...plan, assetId: event.target.value })
          }
          className="border-input bg-background text-foreground min-w-0 rounded-md border px-2 py-1 text-xs"
        >
          {project?.assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.path}
            </option>
          ))}
        </select>
      ) : null}
      {plan.kind === 'ai-image' || plan.kind === 'ai-clip' ? (
        <input
          value={plan.prompt}
          onChange={(event) =>
            onChange({ ...plan, prompt: event.target.value })
          }
          placeholder={t.video.storyboard.assetPrompt}
          className="border-input bg-background text-foreground min-w-0 rounded-md border px-2 py-1 text-xs"
        />
      ) : null}
      {plan.kind === 'broll-search' ? (
        <input
          value={plan.query}
          onChange={(event) => onChange({ ...plan, query: event.target.value })}
          placeholder={t.video.storyboard.brollQuery}
          className="border-input bg-background text-foreground min-w-0 rounded-md border px-2 py-1 text-xs"
        />
      ) : null}
      {plan.kind === 'tts-narration' ? (
        <input
          value={plan.text}
          onChange={(event) => onChange({ ...plan, text: event.target.value })}
          placeholder={t.video.storyboard.ttsText}
          className="border-input bg-background text-foreground min-w-0 rounded-md border px-2 py-1 text-xs"
        />
      ) : null}
      {plan.kind === 'lipsync' ? (
        <div className="grid gap-2 md:grid-cols-2">
          <input
            value={plan.text}
            onChange={(event) =>
              onChange({ ...plan, text: event.target.value })
            }
            placeholder={t.video.editor.inspector.plan.lipsync.text}
            className="border-input bg-background text-foreground min-w-0 rounded-md border px-2 py-1 text-xs"
          />
          <select
            value={plan.referenceImageAssetId}
            onChange={(event) =>
              onChange({
                ...plan,
                referenceImageAssetId: event.target.value,
                egressConfirmed: false,
              })
            }
            className="border-input bg-background text-foreground min-w-0 rounded-md border px-2 py-1 text-xs"
          >
            <option value="">
              {t.video.editor.inspector.scene.referenceNone}
            </option>
            {project?.assets
              .filter((asset) => asset.kind === 'image')
              .map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.path}
                </option>
              ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

function defaultPlan(
  kind: VideoAssetPlan['kind'],
  scene: VideoStoryboardScene,
  assetId?: string,
): VideoAssetPlan {
  if (kind === 'existing') return { kind, assetId: assetId ?? '' };
  if (kind === 'image-pan') return { kind, assetId: assetId ?? '' };
  if (kind === 'ai-image')
    return { kind, prompt: scene.intent, aspectRatio: '16:9' };
  if (kind === 'broll-search')
    return { kind, query: scene.intent, provider: 'pexels' };
  if (kind === 'tts-narration')
    return { kind, text: scene.caption?.text ?? scene.intent };
  if (kind === 'lipsync')
    return {
      kind,
      text: scene.caption?.text ?? scene.intent,
      referenceImageAssetId: assetId ?? '',
      lipsyncProvider: 'auto',
      aspectRatio: '16:9',
      motionScale: 0.5,
      background: { kind: 'transparent' },
      egressConfirmed: false,
    };
  return {
    kind: 'ai-clip',
    prompt: scene.intent,
    aspectRatio: '16:9',
    durationMs: scene.durationMs,
    provider: 'seedance-2-0-fast',
  };
}

function transitionLabelId(labelKey: `transitions.${string}`): string {
  return labelKey.slice('transitions.'.length);
}

function supportsFfmpeg(native: readonly string[]): boolean {
  return native.some((path) => path === 'ffmpeg');
}

function supportsRemotion(native: readonly string[]): boolean {
  return native.some((path) => path === 'remotion');
}

function transitionRenderNote(
  native: readonly string[],
  remotionOnly: string,
  ffmpegOnly: string,
): string {
  if (!supportsFfmpeg(native)) return ` (${remotionOnly})`;
  if (!supportsRemotion(native)) return ` (${ffmpegOnly})`;
  return '';
}
