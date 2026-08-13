import { useMemo, useState } from 'react';

import { Import } from 'lucide-react';

import {
  DesignSystemGrid,
  searchableDesignSystemValues,
} from '@/components/design/DesignSystemGrid';
import { DesignSystemRegistryImportDialog } from '@/components/design/DesignSystemRegistryImportDialog';
import { GalleryFilters } from '@/components/design/GalleryFilters';
import { Button } from '@/components/ui/button';
import { CatalogSortToggle } from '@/components/ui/catalog-sort-toggle';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  installDesignSystemCatalogPack,
  uninstallDesignSystemCatalogPack,
  updateDesignSystemCatalogPack,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSystemRecord } from '@/shared/types/design-mode';
import {
  type CatalogSortOrder,
  catalogTimestamp,
  readStoredCatalogSortOrder,
  sortByNewest,
  writeStoredCatalogSortOrder,
} from '@/shared/utils/catalog-sort';

const CATALOG_SORT_KEY = 'design-systems';

export function DesignSystemsTab({
  systems,
  selectedId,
  onPreview,
  onSelectDefault,
  onStartProject,
  onCatalogChanged,
  actionError,
}: {
  systems: DesignSystemRecord[];
  selectedId?: string;
  onPreview: (system: DesignSystemRecord) => void;
  onSelectDefault: (system: DesignSystemRecord) => void;
  onStartProject?: (system: DesignSystemRecord) => void;
  onCatalogChanged: () => void;
  actionError?: string;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [renameTarget, setRenameTarget] = useState<DesignSystemRecord | null>(
    null,
  );
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<CatalogSortOrder>(() =>
    readStoredCatalogSortOrder(CATALOG_SORT_KEY),
  );
  // The newest toggle only appears when some record carries a real timestamp
  // (installed packs and imported systems); a purely bundled catalog would
  // make `newest` a no-op.
  const hasTimestamps = useMemo(
    () => systems.some((system) => catalogTimestamp(system) !== undefined),
    [systems],
  );
  const changeSortOrder = (order: CatalogSortOrder) => {
    setSortOrder(order);
    writeStoredCatalogSortOrder(CATALOG_SORT_KEY, order);
  };
  const categoryOptions = useMemo(
    () =>
      [...new Set(systems.map((system) => system.category))]
        .sort()
        .map((category) => ({
          label: category,
          value: category,
        })),
    [systems],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const curated = orderDesignSystems(systems);
    const ordered =
      sortOrder === 'newest'
        ? sortByNewest(curated, catalogTimestamp)
        : curated;
    return ordered.filter((system) => {
      if (categoryFilter !== 'all' && system.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return searchableDesignSystemValues(system).some((value) =>
        value.toLowerCase().includes(q),
      );
    });
  }, [systems, categoryFilter, query, sortOrder]);
  const localSystems = filtered.filter(isLocalDesignSystem);
  const catalogSystems = filtered.filter(
    (system) => !isLocalDesignSystem(system),
  );

  const updateInstall = async (system: DesignSystemRecord) => {
    setPendingId(system.id);
    setError('');
    try {
      if (system.canUninstall) {
        await uninstallDesignSystemCatalogPack(system.id);
      } else {
        await installDesignSystemCatalogPack(system.id);
      }
      onCatalogChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  const openRename = (system: DesignSystemRecord) => {
    setRenameTarget(system);
    setRenameTitle(system.title);
    setRenameError('');
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    setPendingId(renameTarget.id);
    setRenameError('');
    try {
      await updateDesignSystemCatalogPack(renameTarget.id, {
        title: renameTitle,
      });
      setRenameTarget(null);
      onCatalogChanged();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  const handleImported = (system: DesignSystemRecord) => {
    onCatalogChanged();
    onPreview(system);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {hasTimestamps ? (
          <CatalogSortToggle
            order={sortOrder}
            onChange={changeSortOrder}
            curatedLabel={t.design.catalogSortCurated}
            newestLabel={t.design.catalogSortNewest}
            testId="design-systems-sort-order"
          />
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => setImportOpen(true)}
          data-testid="design-system-import-shadcn"
        >
          <Import className="size-4" />
          {t.design.importShadcnRegistry}
        </Button>
      </div>
      <GalleryFilters
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder={t.design.searchDesignSystems}
        searchTestId="design-systems-search"
        filters={[
          {
            label: t.design.categoryFilter,
            value: categoryFilter,
            onChange: setCategoryFilter,
            allLabel: t.design.allCategories,
            options: categoryOptions,
            testId: 'design-systems-category-filter',
          },
        ]}
      />
      {(error || actionError) && (
        <p className="text-destructive text-sm">{error || actionError}</p>
      )}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.design.noMatches}</p>
      ) : (
        <div className="space-y-6">
          {localSystems.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                {t.design.customDesignSystemsGroup}
              </h2>
              <DesignSystemGrid
                systems={localSystems}
                pendingId={pendingId}
                selectedId={selectedId}
                onInstall={updateInstall}
                onPreview={onPreview}
                onRename={openRename}
                onSelectDefault={onSelectDefault}
                onStartProject={onStartProject}
              />
            </section>
          )}
          {catalogSystems.length > 0 && (
            <DesignSystemGrid
              systems={catalogSystems}
              pendingId={pendingId}
              selectedId={selectedId}
              onInstall={updateInstall}
              onPreview={onPreview}
              onRename={openRename}
              onSelectDefault={onSelectDefault}
              onStartProject={onStartProject}
            />
          )}
        </div>
      )}
      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.design.renameDesignSystem}</DialogTitle>
            <DialogDescription>
              {renameTarget?.summary || t.design.designSystemPreview}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            <span>{t.design.projectName}</span>
            <input
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              className="border-input bg-background focus:ring-ring/40 h-10 rounded-md border px-3 outline-none focus:ring-2"
              data-testid="design-system-rename-input"
            />
          </label>
          {renameError && (
            <p className="text-destructive text-sm">{renameError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRenameTarget(null)}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              disabled={
                !renameTitle.trim() ||
                Boolean(renameTarget && pendingId === renameTarget.id)
              }
              data-testid="design-system-rename-submit"
              onClick={() => void submitRename()}
            >
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DesignSystemRegistryImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={handleImported}
      />
    </div>
  );
}

export function orderDesignSystems(
  systems: DesignSystemRecord[],
): DesignSystemRecord[] {
  return [...systems].sort((a, b) => {
    const rank = designSystemRank(a) - designSystemRank(b);
    return rank || a.title.localeCompare(b.title);
  });
}

function designSystemRank(system: DesignSystemRecord) {
  if (system.editable) return 0;
  if (system.origin === 'installed') return 1;
  return 2;
}

function isLocalDesignSystem(system: DesignSystemRecord) {
  return system.origin === 'installed';
}
