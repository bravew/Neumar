import { useMemo } from 'react';

import { Film } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoStoryboardScene } from '@/shared/types/video';
import { videoTransitionKind } from '@/shared/types/video';

import { useTimelineUiStore } from './timeline/useTimelineUiStore';

interface PreviewSceneStripProps {
  scenes: VideoStoryboardScene[];
  selectedSceneId?: string | null;
  onSelectScene?: (sceneId: string) => void;
  className?: string;
}

export function PreviewSceneStrip({
  scenes,
  selectedSceneId,
  onSelectScene,
  className,
}: PreviewSceneStripProps) {
  const { t } = useLanguage();
  const setPlayheadMs = useTimelineUiStore((state) => state.setPlayheadMs);
  // Map sceneId → cumulative start time (ms). Driven by storyboard ordering
  // so a click always lands the player at the same place, even when re-clicking
  // the already-selected scene (where a React-effect-based seek would no-op).
  const sceneStartByIdMs = useMemo(() => {
    const out = new Map<string, number>();
    let acc = 0;
    for (const scene of scenes) {
      out.set(scene.id, acc);
      acc += Math.max(0, scene.durationMs);
    }
    return out;
  }, [scenes]);

  return (
    <section
      className={cn('border-border bg-background rounded-md border', className)}
      aria-label={t.video.editor.preview.sceneStrip.title}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <Film className="text-muted-foreground size-4" />
        <h3 className="text-foreground text-sm font-semibold">
          {t.video.editor.preview.sceneStrip.title}
        </h3>
      </div>
      {scenes.length === 0 ? (
        <div className="text-muted-foreground p-3 text-xs">
          {t.video.editor.preview.sceneStrip.empty}
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          <div className="flex min-w-max gap-2">
            {scenes.map((scene, index) => {
              const selected = selectedSceneId === scene.id;
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => {
                    const startMs = sceneStartByIdMs.get(scene.id) ?? 0;
                    setPlayheadMs(startMs);
                    onSelectScene?.(scene.id);
                  }}
                  className={
                    selected
                      ? 'border-primary bg-primary/10 text-foreground w-44 rounded-md border p-2 text-left'
                      : 'border-border hover:bg-accent/60 text-foreground bg-background w-44 rounded-md border p-2 text-left'
                  }
                  aria-current={selected ? 'true' : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {t.video.storyboard.sceneLabel.replace(
                        '{index}',
                        String(index + 1),
                      )}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {Math.round(scene.durationMs / 1000)}s
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs">{scene.intent}</p>
                  <div className="text-muted-foreground mt-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate">{scene.assetPlan.kind}</span>
                    <span>{videoTransitionKind(scene.transition)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
