import { Pencil, Plus } from 'lucide-react';

import {
  DesignSystemCompanyIcon,
  getDesignSystemIconSearchTerms,
} from '@/components/design/DesignSystemCompanyIcon';
import { DesignSystemLivePreview } from '@/components/design/DesignSystemLivePreview';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { Swatches } from './DesignSystemPicker';

export function DesignSystemGrid({
  systems,
  pendingId,
  selectedId,
  onInstall,
  onPreview,
  onRename,
  onSelectDefault,
  onStartProject,
}: {
  systems: DesignSystemRecord[];
  pendingId: string | null;
  selectedId?: string;
  onInstall: (system: DesignSystemRecord) => Promise<void>;
  onPreview: (system: DesignSystemRecord) => void;
  onRename: (system: DesignSystemRecord) => void;
  onSelectDefault: (system: DesignSystemRecord) => void;
  onStartProject?: (system: DesignSystemRecord) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {systems.map((system) => (
        <article
          key={system.id}
          role="button"
          tabIndex={0}
          className="border-border bg-card hover:border-primary/40 focus-visible:ring-ring/50 cursor-pointer overflow-hidden rounded-md border text-left transition-colors outline-none focus-visible:ring-2"
          onClick={() => onPreview(system)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onPreview(system);
            }
          }}
          data-testid={`design-system-card-${system.id}`}
        >
          <DesignSystemLivePreview
            system={system}
            testId={`design-system-preview-${system.id}`}
          />
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <DesignSystemCompanyIcon system={system} />
                <h3 className="min-w-0 text-sm leading-5 font-semibold">
                  {system.title}
                </h3>
              </div>
              <Swatches colors={system.swatches} />
            </div>
            <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
              {system.summary}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                <span className="bg-muted inline-flex rounded px-2 py-1 text-xs">
                  {system.category}
                </span>
                <span className="bg-muted inline-flex rounded px-2 py-1 text-xs">
                  {system.editable
                    ? t.design.customDesignSystemOrigin
                    : system.origin === 'installed'
                      ? t.design.catalogInstalled
                      : t.design.catalogBuiltIn}
                </span>
              </div>
              <Button
                type="button"
                variant={selectedId === system.id ? 'secondary' : 'ghost'}
                size="sm"
                data-testid={`design-system-default-${system.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectDefault(system);
                }}
              >
                {selectedId === system.id
                  ? t.design.defaultDesignSystem
                  : t.design.useAsDefaultDesignSystem}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {system.editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`design-system-rename-${system.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRename(system);
                  }}
                >
                  <Pencil className="size-4" />
                  {t.design.renameDesignSystem}
                </Button>
              )}
              {onStartProject && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid={`design-system-start-${system.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartProject(system);
                  }}
                >
                  <Plus className="size-4" />
                  {t.design.startDesignSystemProject}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pendingId === system.id}
                onClick={(event) => {
                  event.stopPropagation();
                  void onInstall(system);
                }}
              >
                {pendingId === system.id
                  ? t.design.catalogUpdating
                  : system.canUninstall
                    ? t.design.catalogUninstall
                    : t.design.catalogInstall}
              </Button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function searchableDesignSystemValues(
  system: DesignSystemRecord,
): string[] {
  return [
    system.title,
    system.summary,
    system.category,
    ...getDesignSystemIconSearchTerms(system),
    ...system.tokens,
    ...system.swatches,
  ];
}
