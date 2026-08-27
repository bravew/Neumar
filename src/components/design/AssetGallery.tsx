import {
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { toast } from 'sonner';

import { AssetCatalogPickerDialog } from '@/components/assets/AssetCatalogPickerDialog';
import { AssetMaterializationNotice } from '@/components/assets/AssetMaterializationNotice';
import {
  ASSET_DRAG_MIME,
  acquireAssetMaterializationLease,
  applyAssetMaterializationBudgetIncrease,
  isAssetMaterializationBudgetError,
  readAssetDragPayload,
} from '@/shared/assets';
import type { AssetMaterializationBudgetError } from '@/shared/assets';
import {
  ASSET_MATERIALIZATION_NOTICE_TTL_MS,
  useAssetMaterializationEvents,
  useLatestMaterializationState,
} from '@/shared/hooks/useAssetMaterializationEvents';
import {
  attachCatalogAssetToDesign,
  getDesignAssetProvenance,
  listDesignAssetVersions,
  promoteDesignAssetVersion,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignAssetVersion,
  DesignAssetProvenance,
  DesignOutput,
  DesignProject,
} from '@/shared/types/design-mode';
import { randomUUID } from '@/shared/utils/uuid';

import { AssetGalleryGrid } from './AssetGalleryGrid';
import { AssetProvenanceDialog } from './AssetProvenanceDialog';
import { CompareModal } from './CompareModal';
import { DesignAssetGalleryToolbar } from './DesignAssetGalleryToolbar';
import { DesignAssetsBrowserDialog } from './DesignAssetsBrowserDialog';

export function AssetGallery({
  projectId,
  assets,
  onOpen,
  onProjectChange,
}: {
  projectId: string;
  assets: DesignOutput[];
  onOpen: (path: string) => void;
  onProjectChange?: (project: DesignProject) => void;
}) {
  const { t } = useLanguage();
  const assetLabels = t.assets;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<
    Record<string, DesignAssetVersion[]>
  >({});
  const [compare, setCompare] = useState<{
    left: DesignAssetVersion | null;
    right: DesignAssetVersion | null;
  }>({ left: null, right: null });
  const [provenance, setProvenance] = useState<{
    open: boolean;
    value: DesignAssetProvenance | null;
  }>({ open: false, value: null });
  const [dragActive, setDragActive] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [budgetIssue, setBudgetIssue] =
    useState<AssetMaterializationBudgetError | null>(null);
  const [budgetIncreasing, setBudgetIncreasing] = useState(false);
  const [activeAssetIds, setActiveAssetIds] = useState<string[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [assetsBrowserOpen, setAssetsBrowserOpen] = useState(false);
  const sessionIdRef = useRef(`design-assets-${randomUUID()}`);
  const pendingBudgetAssetIdsRef = useRef<string[]>([]);
  const activeAssetClearTimerRef = useRef<number | null>(null);
  const materializationStates = useAssetMaterializationEvents(
    sessionIdRef.current,
  );
  const materializationState = useLatestMaterializationState(
    materializationStates,
    activeAssetIds,
  );

  const loadVersions = async (asset: DesignOutput) => {
    if (!versions[asset.id]) {
      const result = await listDesignAssetVersions(projectId, asset.id);
      setVersions((prev) => ({ ...prev, [asset.id]: result.versions }));
    }
    setExpandedId((prev) => (prev === asset.id ? null : asset.id));
  };

  const promoteVersion = async (
    asset: DesignOutput,
    version: DesignAssetVersion,
  ) => {
    const result = await promoteDesignAssetVersion(
      projectId,
      asset.id,
      version.path,
    );
    onProjectChange?.(result.project);
  };

  const openProvenance = async (asset: DesignOutput) => {
    setProvenance({ open: true, value: null });
    try {
      const result = await getDesignAssetProvenance(projectId, asset.id);
      setProvenance({ open: true, value: result.provenance });
    } catch {
      setProvenance({ open: true, value: null });
    }
  };

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);

  useEffect(
    () => () => {
      if (activeAssetClearTimerRef.current) {
        window.clearTimeout(activeAssetClearTimerRef.current);
      }
    },
    [],
  );

  const attachCatalogAssetIds = useCallback(
    async (assetIds: string[]) => {
      // The event stream only exists while a lease is held; releasing on
      // settle leaves the grace window open for trailing derivative events.
      const releaseLease = acquireAssetMaterializationLease(
        sessionIdRef.current,
      );
      try {
        for (const assetId of assetIds) {
          const result = await attachCatalogAssetToDesign(projectId, assetId, {
            sessionId: sessionIdRef.current,
          });
          onProjectChange?.(result.project);
        }
      } finally {
        releaseLease();
      }
    },
    [onProjectChange, projectId],
  );

  const showAttachError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(assetLabels.materializeFailed.replace('{message}', message));
    },
    [assetLabels.materializeFailed],
  );

  const scheduleActiveAssetClear = useCallback(() => {
    activeAssetClearTimerRef.current = window.setTimeout(() => {
      setActiveAssetIds([]);
      activeAssetClearTimerRef.current = null;
    }, ASSET_MATERIALIZATION_NOTICE_TTL_MS);
  }, []);

  const handleBudgetIncreaseRetry = useCallback(async () => {
    if (!budgetIssue) return;
    const assetIds = pendingBudgetAssetIdsRef.current;
    if (assetIds.length === 0) return;
    if (activeAssetClearTimerRef.current) {
      window.clearTimeout(activeAssetClearTimerRef.current);
      activeAssetClearTimerRef.current = null;
    }
    setBudgetIncreasing(true);
    setAttaching(true);
    try {
      await applyAssetMaterializationBudgetIncrease(budgetIssue.detail);
      setBudgetIssue(null);
      setActiveAssetIds(assetIds);
      await attachCatalogAssetIds(assetIds);
    } catch (error) {
      if (isAssetMaterializationBudgetError(error)) {
        setBudgetIssue(error);
      } else {
        showAttachError(error);
      }
    } finally {
      setBudgetIncreasing(false);
      setAttaching(false);
      scheduleActiveAssetClear();
    }
  }, [
    attachCatalogAssetIds,
    budgetIssue,
    scheduleActiveAssetClear,
    showAttachError,
  ]);

  const attachCatalogSelection = useCallback(
    async (assetIds: string[]) => {
      if (activeAssetClearTimerRef.current) {
        window.clearTimeout(activeAssetClearTimerRef.current);
        activeAssetClearTimerRef.current = null;
      }
      setAttaching(true);
      setBudgetIssue(null);
      setActiveAssetIds(assetIds);
      pendingBudgetAssetIdsRef.current = assetIds;
      try {
        await attachCatalogAssetIds(assetIds);
      } catch (error) {
        if (isAssetMaterializationBudgetError(error)) {
          setBudgetIssue(error);
        } else {
          showAttachError(error);
        }
      } finally {
        setAttaching(false);
        scheduleActiveAssetClear();
      }
    },
    [attachCatalogAssetIds, scheduleActiveAssetClear, showAttachError],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      const payload = readAssetDragPayload(event.dataTransfer);
      setDragActive(false);
      if (!payload) return;
      event.preventDefault();
      await attachCatalogSelection(payload.assetIds);
    },
    [attachCatalogSelection],
  );

  return (
    <>
      <DesignAssetGalleryToolbar
        assetCount={assets.length}
        browseAssetsLabel={t.design.browseGeneratedAssets}
        browseCatalogLabel={assetLabels.browseCatalog}
        onBrowseAssets={() => setAssetsBrowserOpen(true)}
        onBrowseCatalog={() => setCatalogOpen(true)}
      />
      <div
        className={
          dragActive
            ? 'border-primary/70 rounded-md border border-dashed p-2'
            : 'rounded-md border border-transparent p-2'
        }
        aria-busy={attaching}
        onDragEnter={handleDragOver}
        onDragLeave={() => setDragActive(false)}
        onDragOver={handleDragOver}
        onDrop={(event) => void handleDrop(event)}
      >
        <AssetMaterializationNotice
          attaching={attaching}
          attachError={null}
          budgetIncreasing={budgetIncreasing}
          budgetIssue={budgetIssue}
          className="mb-2 rounded-md px-3 py-2 text-xs"
          labels={assetLabels}
          onBudgetRetry={() => void handleBudgetIncreaseRetry()}
          state={materializationState}
        />
        {assets.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            {t.design.generatedAssetsEmpty}
          </div>
        ) : (
          <AssetGalleryGrid
            projectId={projectId}
            assets={assets}
            versions={versions}
            expandedId={expandedId}
            onOpen={onOpen}
            onVersions={(asset) => void loadVersions(asset)}
            onCompare={(left, right) => setCompare({ left, right })}
            onProvenance={(asset) => void openProvenance(asset)}
            onPromote={(asset, version) => void promoteVersion(asset, version)}
          />
        )}
      </div>
      <CompareModal
        projectId={projectId}
        open={Boolean(compare.left || compare.right)}
        onOpenChange={(open) => {
          if (!open) setCompare({ left: null, right: null });
        }}
        left={compare.left}
        right={compare.right}
      />
      <AssetProvenanceDialog
        open={provenance.open}
        provenance={provenance.value}
        onOpenChange={(open) => setProvenance((prev) => ({ ...prev, open }))}
        onOpenPrompt={(path) => {
          setProvenance({ open: false, value: null });
          onOpen(path);
        }}
      />
      <DesignAssetsBrowserDialog
        open={assetsBrowserOpen}
        projectId={projectId}
        assets={assets}
        onOpenChange={setAssetsBrowserOpen}
        onOpenAsset={(asset) => onOpen(asset.path)}
      />
      <AssetCatalogPickerDialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onAttach={attachCatalogSelection}
      />
    </>
  );
}
