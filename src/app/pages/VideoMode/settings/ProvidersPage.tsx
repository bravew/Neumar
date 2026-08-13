import { ProviderPanel } from '@/components/video/ProviderPanel';
import { useLanguage } from '@/shared/providers/language-provider';

import { VideoSettingsShell } from './VideoSettingsShell';

export function VideoProvidersSettingsPage() {
  const { t } = useLanguage();

  return (
    <VideoSettingsShell
      title={t.video.settings.providers.title}
      description={t.video.settings.providers.description}
    >
      <div className="max-w-3xl">
        <ProviderPanel />
      </div>
    </VideoSettingsShell>
  );
}
