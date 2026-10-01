import { useState } from 'react';

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../components/Switch';
import type { SettingsType } from '../types';

export function SimpleShellOptIn({
  settings,
  onSettingsChange,
}: {
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
}) {
  const { t, tt } = useLanguage();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const opens = settings.ui.usageActivityOpens ?? 0;

  return (
    <section className="space-y-3" data-testid="simple-shell-opt-in">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <div className="text-foreground text-sm font-medium">
            {t.settings.simpleShell}
          </div>
          <p className="text-muted-foreground text-xs">
            {t.settings.simpleShellDescription}
          </p>
        </div>
        <Switch
          checked={settings.ui.simpleShell}
          label={t.settings.simpleShell}
          onChange={(checked) =>
            onSettingsChange({
              ...settings,
              ui: { ...settings.ui, simpleShell: checked },
            })
          }
        />
      </div>
      <button
        type="button"
        className="text-primary text-sm underline"
        onClick={() => setFeedbackOpen(true)}
      >
        {t.common.feedback.menuLabel}
      </button>
      <p
        data-testid="usage-activity-opens"
        className="text-muted-foreground text-xs"
      >
        {tt('settings.usageActivityOpens', {
          name: t.nav.dashboard,
          count: opens,
        })}
      </p>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </section>
  );
}
