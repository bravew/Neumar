import { Library } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { VideoSettingsShell } from './VideoSettingsShell';

export function VideoAssetsLibraryPage() {
  const { t } = useLanguage();

  return (
    <VideoSettingsShell
      title={t.video.settings.assets.title}
      description={t.video.settings.assets.description}
    >
      <section className="border-border bg-background flex min-h-64 max-w-3xl items-center justify-center rounded-md border border-dashed">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Library className="size-4" />
          <span>{t.video.settings.assets.placeholder}</span>
        </div>
      </section>
    </VideoSettingsShell>
  );
}
