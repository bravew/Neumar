import { useEffect, useState } from 'react';

import { SettingsModal } from '@/components/settings/SettingsModal';

import { isSettingsCategory, SETTINGS_DISMISSED_EVENT } from './openSettings';
import type { SettingsCategory } from './types';

export function SettingsHost() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SettingsCategory | undefined>();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      setCategory(isSettingsCategory(detail) ? detail : undefined);
      setOpen(true);
    };
    window.addEventListener('open-settings', handler);
    return () => window.removeEventListener('open-settings', handler);
  }, []);

  return (
    <SettingsModal
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCategory(undefined);
          window.dispatchEvent(new CustomEvent(SETTINGS_DISMISSED_EVENT));
        }
      }}
      initialCategory={category}
    />
  );
}
