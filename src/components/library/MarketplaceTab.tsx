/**
 * MarketplaceTab — plugin marketplace with two sub-views: Available (catalog
 * entries merged from configured sources) and Sources (add/refresh/remove
 * catalog URLs). Mirrors the Open Design plugins page structure.
 */

import { useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { MarketplaceAvailableView } from './MarketplaceAvailableView';
import { PluginSourcesPanel } from './PluginSourcesPanel';

type MarketplaceSubView = 'available' | 'sources';

export function MarketplaceTab() {
  const { t } = useLanguage();
  const [view, setView] = useState<MarketplaceSubView>('available');

  return (
    <div className="flex flex-col gap-4">
      <div
        className="border-border inline-flex w-fit gap-1 rounded-md border p-0.5"
        role="tablist"
      >
        <SubTab
          active={view === 'available'}
          label={t.plugins.tabs.available}
          onClick={() => setView('available')}
        />
        <SubTab
          active={view === 'sources'}
          label={t.plugins.tabs.sources}
          onClick={() => setView('sources')}
        />
      </div>

      {view === 'available' ? (
        <MarketplaceAvailableView />
      ) : (
        <PluginSourcesPanel />
      )}
    </div>
  );
}

function SubTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
