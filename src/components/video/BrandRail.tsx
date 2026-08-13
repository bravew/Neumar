import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';

export function BrandRail({
  project,
  onPatch,
}: {
  project: VideoProject;
  onPatch: VideoProjectEditorActions['patchProject'];
}) {
  const { t } = useLanguage();
  const brandKit = project.brandKit ?? {};

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-foreground text-sm font-semibold">
          {t.video.editor.sideRail.brand.title}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t.video.editor.sideRail.brand.description}
        </p>
      </div>
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.inputs.primaryColor}</span>
        <input
          type="color"
          value={brandKit.primaryColor ?? '#4f46e5'}
          onChange={(event) =>
            void onPatch({
              brandKit: { ...brandKit, primaryColor: event.target.value },
            })
          }
          className="border-input bg-background h-9 w-full rounded-md border px-2"
        />
      </label>
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{t.video.inputs.fontFamily}</span>
        <input
          value={brandKit.fontFamily ?? ''}
          onChange={(event) =>
            void onPatch({
              brandKit: { ...brandKit, fontFamily: event.target.value },
            })
          }
          className="border-input bg-background text-foreground w-full rounded-md border px-3 py-2"
        />
      </label>
    </section>
  );
}
