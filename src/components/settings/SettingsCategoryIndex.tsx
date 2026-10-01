import type { RefObject } from 'react';

import { APP_NAME } from '@/config/branding';
import { useLanguage } from '@/shared/providers/language-provider';

import { categoriesForPage, type SettingsPageId } from './navigation';
import { SettingsDangerRow } from './primitives/SettingsDangerRow';
import { SettingsRow } from './primitives/SettingsRow';
import type { SettingsCategory } from './types';

export function SettingsCategoryIndex({
  pageId,
  onOpen,
  scrollerRef,
}: {
  pageId: SettingsPageId;
  onOpen: (category: SettingsCategory) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const { t, tt } = useLanguage();
  const labels = t.settings as Record<string, string>;
  const categories = categoriesForPage(pageId);

  return (
    <div
      ref={scrollerRef}
      data-testid="settings-page-scroll"
      className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
    >
      {categories.map((category) => (
        <SettingsRow
          key={category}
          variant="chevron"
          label={labels[category] ?? category}
          onSelect={() => onOpen(category)}
        />
      ))}
      {pageId === 'data' ? (
        <SettingsDangerRow
          label={tt('settings.resetProduct', { name: APP_NAME })}
          caption={t.settings.dataClearAllDescription}
          actionLabel={t.settings.dataClearAll}
          onAction={() => onOpen('data')}
        />
      ) : null}
    </div>
  );
}
