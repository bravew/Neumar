import { Palette } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { VideoSettingsShell } from './VideoSettingsShell';

export function VideoBrandSettingsPage() {
  const { t } = useLanguage();

  return (
    <VideoSettingsShell
      title={t.video.settings.brand.title}
      description={t.video.settings.brand.description}
    >
      <div className="max-w-2xl space-y-4">
        <section className="border-border bg-background rounded-md border p-4">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Palette className="size-4" />
            <span>{t.video.settings.brand.defaults}</span>
          </div>
          <p className="text-muted-foreground mt-3 text-sm">
            {t.video.settings.brand.placeholder}
          </p>
        </section>
      </div>
    </VideoSettingsShell>
  );
}
