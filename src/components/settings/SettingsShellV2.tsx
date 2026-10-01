import { useState } from 'react';

import { Search } from 'lucide-react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { Settings as SettingsType } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { ModelsAdvanced, ModelsPage } from './ModelsPage';
import {
  CATEGORY_TO_LOCATION,
  resolveSettingsLocation,
  SETTINGS_PAGES,
  settingsPage,
  type SettingsPageId,
} from './navigation';
import { PermissionsPage } from './PermissionsPage';
import { SettingsDrillIn } from './primitives/SettingsDrillIn';
import { SettingsContent } from './SettingsContent';
import type { SettingsCategory } from './types';

export function SettingsShellV2({
  open,
  onOpenChange,
  activeCategory,
  onSelectCategory,
  settings,
  onSettingsChange,
  defaultPaths,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeCategory: SettingsCategory;
  onSelectCategory: (category: SettingsCategory) => void;
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
  defaultPaths: { workDir: string; mcpConfigPath: string; skillsPath: string };
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const labels = t.settings as Record<string, string>;
  const labelFor = (key: string) =>
    labels[key] ?? t.settings[key as SettingsCategory] ?? key;
  const location = resolveSettingsLocation(activeCategory);
  const page = settingsPage(location.page);
  const q = query.trim().toLowerCase();
  const entries = q
    ? searchSettings(q, labelFor)
    : SETTINGS_PAGES.map((entry) => ({
        page: entry.id,
        category: entry.homeCategory,
        label: labelFor(entry.labelKey),
      }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="settings-modal"
        className="flex h-[560px] max-h-[100dvh] w-[760px] !max-w-[calc(100vw-2rem)] flex-row gap-0 overflow-hidden p-0 duration-[var(--motion-base)] max-[720px]:h-dvh max-[720px]:w-screen max-[720px]:!max-w-none max-[720px]:rounded-none"
      >
        <nav className="border-border flex w-56 shrink-0 flex-col border-r">
          <div className="px-3 py-3">
            <label className="border-input flex h-8 items-center gap-2 rounded-lg border px-2 text-sm">
              <Search className="text-muted-foreground size-3.5" />
              <input
                data-testid="settings-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.settings.searchSettings}
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {entries.map((entry) => {
              const definition = settingsPage(entry.page);
              const Icon = definition.icon;
              const selected = !q && location.page === entry.page;
              return (
                <button
                  key={`${entry.page}-${entry.category}`}
                  type="button"
                  onClick={() => {
                    onSelectCategory(entry.category);
                    setQuery('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm',
                    selected
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{entry.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
        {location.page === 'models' && location.drillIn === 'advanced' ? (
          <SettingsDrillIn
            title={labelFor(activeCategory)}
            backLabel={labelFor(page.labelKey)}
            onBack={() => onSelectCategory(page.homeCategory)}
          >
            <ModelsAdvanced
              settings={settings}
              onSettingsChange={onSettingsChange}
            />
          </SettingsDrillIn>
        ) : location.drillIn ? (
          <SettingsDrillIn
            title={labelFor(activeCategory)}
            backLabel={labelFor(page.labelKey)}
            onBack={() => onSelectCategory(page.homeCategory)}
          >
            <SettingsContent
              activeCategory={activeCategory}
              settings={settings}
              onSettingsChange={onSettingsChange}
              defaultPaths={defaultPaths}
            />
          </SettingsDrillIn>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <h2
              data-testid="settings-active-category"
              className="text-foreground px-6 pt-4 pb-3 text-lg font-semibold"
            >
              {labelFor(page.labelKey)}
            </h2>
            {location.page === 'permissions' ? (
              <PermissionsPage
                settings={settings}
                onSettingsChange={onSettingsChange}
              />
            ) : location.page === 'models' ? (
              <ModelsPage
                settings={settings}
                onSettingsChange={onSettingsChange}
                onOpenAdvanced={() => onSelectCategory('agentRuntimes')}
              />
            ) : (
              <SettingsContent
                activeCategory={activeCategory}
                settings={settings}
                onSettingsChange={onSettingsChange}
                defaultPaths={defaultPaths}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SearchHit {
  page: SettingsPageId;
  category: SettingsCategory;
  label: string;
}

function searchSettings(
  query: string,
  labelFor: (key: string) => string,
): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (hit: SearchHit) => {
    const id = `${hit.page}:${hit.category}`;
    if (seen.has(id)) return;
    seen.add(id);
    hits.push(hit);
  };

  for (const entry of SETTINGS_PAGES) {
    if (labelFor(entry.labelKey).toLowerCase().includes(query)) {
      push({
        page: entry.id,
        category: entry.homeCategory,
        label: labelFor(entry.labelKey),
      });
    }
  }

  for (const [category, location] of Object.entries(CATEGORY_TO_LOCATION) as [
    SettingsCategory,
    (typeof CATEGORY_TO_LOCATION)[SettingsCategory],
  ][]) {
    const matched = location.searchKeys.some(
      (key) =>
        key.toLowerCase().includes(query) ||
        labelFor(key).toLowerCase().includes(query),
    );
    if (!matched) continue;
    push({
      page: location.page,
      category,
      label: labelFor(category),
    });
  }

  return hits;
}
