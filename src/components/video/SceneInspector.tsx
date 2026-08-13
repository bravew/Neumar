import { FolderSearch, RefreshCw, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoProject,
  VideoReframeAnchor,
  VideoStoryboardScene,
} from '@/shared/types/video';
import {
  VIDEO_TRANSITION_REGISTRY,
  videoTransitionKind,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';
import { SceneAssetPlanInspector } from './SceneAssetPlanInspector';
import { SceneAudioCaptionInspector } from './SceneAudioCaptionInspector';

const REFRAME_ASPECTS: VideoAspectRatio[] = ['9:16', '1:1', '4:5', '16:9'];
const REFRAME_ANCHORS: VideoReframeAnchor[] = [
  'center',
  'left',
  'right',
  'top',
  'bottom',
  'top-third',
];

interface SceneInspectorProps {
  project: VideoProject;
  scene: VideoStoryboardScene | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: VideoProjectEditorActions;
  onFindContext?: (sceneId: string) => void;
  /** When true, renders the body directly (no outer aside chrome, no close
   * button). Use when embedding inside a tab/sheet that already provides those. */
  inline?: boolean;
}

export function SceneInspector({
  project,
  scene,
  open,
  onOpenChange,
  actions,
  onFindContext,
  inline = false,
}: SceneInspectorProps) {
  const { t } = useLanguage();
  const storyboard = project.storyboard;
  const transitionLabels = t.video.storyboard.transitions as Record<
    string,
    string
  >;

  const updateScene = async (
    updater: (scene: VideoStoryboardScene) => VideoStoryboardScene,
  ) => {
    if (!storyboard || !scene) return;
    await actions.updateStoryboard({
      ...storyboard,
      scenes: storyboard.scenes.map((candidate) =>
        candidate.id === scene.id ? updater(candidate) : candidate,
      ),
    });
  };
  const patchScene = async (patch: Partial<VideoStoryboardScene>) => {
    await updateScene((candidate) => ({ ...candidate, ...patch }));
  };
  const clearSceneReframe = async () => {
    await updateScene((candidate) => {
      const { reframe: _reframe, ...next } = candidate;
      return next;
    });
  };
  const patchSceneReframe = async (
    patch: Partial<NonNullable<VideoStoryboardScene['reframe']>>,
  ) => {
    if (!scene) return;
    await patchScene({
      reframe: {
        aspect: scene.reframe?.aspect ?? '9:16',
        anchor: scene.reframe?.anchor ?? 'center',
        ...scene.reframe,
        ...patch,
      },
    });
  };

  if (!open) return null;

  const headerNode = (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-foreground text-sm font-semibold">
          {t.video.editor.inspector.scene.title}
        </h2>
        <p className="text-muted-foreground text-xs">
          {scene ? scene.assetPlan.kind : t.video.editor.inspector.empty}
        </p>
      </div>
      {!inline ? (
        <button
          type="button"
          className="hover:bg-accent text-muted-foreground rounded-md p-1.5"
          aria-label={t.video.editor.inspector.close}
          onClick={() => onOpenChange(false)}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );

  const Wrapper = inline
    ? ({ children }: { children: React.ReactNode }) => <div>{children}</div>
    : ({ children }: { children: React.ReactNode }) => (
        <aside className="border-border bg-background min-h-0 w-[340px] shrink-0 overflow-auto border-l p-4 max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-20 max-xl:shadow-xl">
          {children}
        </aside>
      );

  return (
    <Wrapper>
      {headerNode}
      {!scene ? (
        <div className="text-muted-foreground text-xs">
          {t.video.editor.inspector.empty}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="text-muted-foreground block space-y-1 text-xs">
            <span>{t.video.editor.inspector.scene.prompt}</span>
            <textarea
              value={scene.intent}
              onChange={(event) =>
                void patchScene({ intent: event.target.value })
              }
              className="border-input bg-background text-foreground min-h-20 w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="text-muted-foreground block space-y-1 text-xs">
            <span>{t.video.editor.inspector.scene.durationMs}</span>
            <input
              type="number"
              min={500}
              step={500}
              value={scene.durationMs}
              onChange={(event) =>
                void patchScene({ durationMs: Number(event.target.value) })
              }
              className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
            />
          </label>
          <SceneAssetPlanInspector
            project={project}
            scene={scene}
            actions={actions}
            onChange={(assetPlan) => void patchScene({ assetPlan })}
          />
          {onFindContext ? (
            <button
              type="button"
              className="border-border hover:bg-accent w-full rounded-md border px-3 py-2 text-xs"
              onClick={() => onFindContext(scene.id)}
            >
              <FolderSearch className="mr-1 inline size-3" />
              {t.video.editor.inspector.scene.findContext}
            </button>
          ) : null}
          <label className="text-muted-foreground block space-y-1 text-xs">
            <span>{t.video.editor.inspector.scene.caption}</span>
            <input
              value={scene.caption?.text ?? ''}
              onChange={(event) =>
                void patchScene({
                  caption: { ...scene.caption, text: event.target.value },
                })
              }
              className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="text-muted-foreground block space-y-1 text-xs">
            <span>{t.video.editor.inspector.scene.transition}</span>
            <select
              value={videoTransitionKind(scene.transition)}
              onChange={(event) =>
                void patchScene({
                  transition: event.target
                    .value as VideoStoryboardScene['transition'],
                })
              }
              className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
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
          </label>
          <label className="text-muted-foreground block space-y-1 text-xs">
            <span>{t.video.editor.inspector.scene.reframeAspect}</span>
            <select
              value={scene.reframe?.aspect ?? 'auto'}
              onChange={(event) => {
                if (event.target.value === 'auto') {
                  void clearSceneReframe();
                  return;
                }
                void patchSceneReframe({
                  aspect: event.target.value as VideoAspectRatio,
                });
              }}
              className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
            >
              <option value="auto">
                {t.video.editor.inspector.scene.reframeAuto}
              </option>
              {REFRAME_ASPECTS.map((aspect) => (
                <option key={aspect} value={aspect}>
                  {aspect}
                </option>
              ))}
            </select>
          </label>
          {scene.reframe ? (
            <div className="grid grid-cols-[1fr_92px] gap-2">
              <label className="text-muted-foreground block space-y-1 text-xs">
                <span>{t.video.editor.inspector.scene.reframeAnchor}</span>
                <select
                  value={scene.reframe.anchor}
                  onChange={(event) =>
                    void patchSceneReframe({
                      anchor: event.target.value as VideoReframeAnchor,
                    })
                  }
                  className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
                >
                  {REFRAME_ANCHORS.map((anchor) => (
                    <option key={anchor} value={anchor}>
                      {t.video.editor.inspector.scene.reframeAnchors[anchor]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-muted-foreground block space-y-1 text-xs">
                <span>{t.video.editor.inspector.scene.reframeOffset}</span>
                <input
                  type="number"
                  step={10}
                  value={scene.reframe.offsetPx ?? 0}
                  onChange={(event) =>
                    void patchSceneReframe({
                      offsetPx: Number(event.target.value) || 0,
                    })
                  }
                  className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
                />
              </label>
            </div>
          ) : null}
          <SceneAudioCaptionInspector
            project={project}
            scene={scene}
            actions={actions}
            onPatchScene={patchScene}
          />
          <button
            type="button"
            className="border-border hover:bg-accent w-full rounded-md border px-3 py-2 text-xs"
            onClick={() => void actions.replanScene(scene.id)}
          >
            <RefreshCw className="mr-1 inline size-3" />
            {t.video.storyboard.replan}
          </button>
        </div>
      )}
    </Wrapper>
  );
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
