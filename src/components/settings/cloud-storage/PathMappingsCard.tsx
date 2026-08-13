import { useCallback, useEffect, useMemo, useState } from 'react';

import { AlertTriangle, Info, Loader2, Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { AddPathMappingDialog } from './AddPathMappingDialog';
import { LanBridgeStatusBadge } from './LanBridgeStatusBadge';
import { PathMappingRow } from './PathMappingRow';
import {
  deriveSuggestedPrefixes,
  findBridgeSampleAsset,
  type CloudStorageItem,
} from './pathMappingSuggestions';
import type {
  BridgeVerificationResult,
  ImmichBridgeAsset,
  PathMappingDiscovery,
  PathMapping,
} from './types';

interface PathMappingsCardProps {
  connectionId: string;
  sampleAsset?: ImmichBridgeAsset;
  suggestedPrefixes?: string[];
  suggestedMounts?: string[];
  className?: string;
}

export function PathMappingsCard({
  connectionId,
  sampleAsset,
  suggestedPrefixes,
  suggestedMounts,
  className,
}: PathMappingsCardProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const [mappings, setMappings] = useState<PathMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [verifyingMappingId, setVerifyingMappingId] = useState<string | null>(
    null,
  );
  const [discoveredSampleAsset, setDiscoveredSampleAsset] = useState<
    ImmichBridgeAsset | undefined
  >(sampleAsset);
  const [discoveredPrefixes, setDiscoveredPrefixes] = useState<string[]>(
    suggestedPrefixes ?? [],
  );
  const [discoveredMounts, setDiscoveredMounts] = useState<string[]>(
    suggestedMounts ?? [],
  );
  const [tailscaleAvailable, setTailscaleAvailable] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(pathMappingsUrl(connectionId), { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { items?: PathMapping[] };
        setMappings(body.items ?? []);
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [connectionId],
  );

  const loadSampleAsset = useCallback(
    async (signal?: AbortSignal) => {
      if (sampleAsset) return;
      try {
        const res = await fetch(
          `${pathMappingsBaseUrl(connectionId)}/items?limit=50`,
          { signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { items?: CloudStorageItem[] };
        const asset = findBridgeSampleAsset(body.items ?? []);
        setDiscoveredSampleAsset(asset);
        if (asset) {
          setDiscoveredPrefixes(deriveSuggestedPrefixes(asset.originalPath));
        }
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setDiscoveredSampleAsset(undefined);
        }
      }
    },
    [connectionId, sampleAsset],
  );

  const loadDiscovery = useCallback(
    async (signal?: AbortSignal) => {
      if (suggestedMounts) return;
      try {
        const res = await fetch(`${pathMappingsUrl(connectionId)}/discovery`, {
          signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as PathMappingDiscovery;
        setDiscoveredMounts(
          Array.from(
            new Set(
              (body.mounts ?? [])
                .map((mount) => mount.path)
                .filter((mount) => mount.trim() !== ''),
            ),
          ),
        );
        setTailscaleAvailable(Boolean(body.tailscale?.available));
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setDiscoveredMounts([]);
          setTailscaleAvailable(false);
        }
      }
    },
    [connectionId, suggestedMounts],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    loadSampleAsset(ctrl.signal);
    loadDiscovery(ctrl.signal);
    return () => ctrl.abort();
  }, [load, loadDiscovery, loadSampleAsset]);

  const verifiedCount = useMemo(
    () =>
      mappings.filter((mapping) => mapping.verified && !mapping.disabled)
        .length,
    [mappings],
  );

  const remove = useCallback(
    async (mappingId: string) => {
      const res = await fetch(`${pathMappingsUrl(connectionId)}/${mappingId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMappings((prev) => prev.filter((mapping) => mapping.id !== mappingId));
    },
    [connectionId],
  );

  const activeSampleAsset = sampleAsset ?? discoveredSampleAsset;

  const verify = useCallback(
    async (mapping: PathMapping) => {
      if (!activeSampleAsset) {
        setError(s.verifyNeedsSampleAsset);
        return;
      }

      setVerifyingMappingId(mapping.id);
      setError(null);
      try {
        const result = await verifyMappingCandidate({
          connectionId,
          sampleAsset: activeSampleAsset,
          mapping,
        });
        const res = await fetch(
          `${pathMappingsUrl(connectionId)}/${encodeURIComponent(mapping.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              verified: result.verified,
              verifiedAt: result.verified ? new Date().toISOString() : null,
              verificationHash: result.verified
                ? result.verificationHash
                : null,
              lastError: result.verified ? null : result.reason,
            }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = (await res.json()) as PathMapping;
        setMappings((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setVerifyingMappingId(null);
      }
    },
    [activeSampleAsset, connectionId, s.verifyNeedsSampleAsset],
  );

  return (
    <section className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{s.pathMappingsTitle}</h3>
          <p className="text-muted-foreground text-sm">
            {s.pathMappingsDescription}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LanBridgeStatusBadge
            available
            verifiedMappings={verifiedCount}
            totalMappings={mappings.length}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => load()}
            aria-label={s.refreshMappings}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            {s.addMapping}
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      )}
      {tailscaleAvailable && (
        <div className="border-border bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <Info className="size-4" />
          {s.tailscaleHint}
        </div>
      )}

      <div className="border-border divide-y rounded-md border">
        {mappings.length === 0 && (
          <div className="text-muted-foreground px-4 py-6 text-center text-sm">
            {loading ? s.loadingMappings : s.noPathMappings}
          </div>
        )}
        {mappings.map((mapping) => (
          <PathMappingRow
            key={mapping.id}
            mapping={mapping}
            canVerify={Boolean(activeSampleAsset)}
            verifying={verifyingMappingId === mapping.id}
            onVerify={() => verify(mapping)}
            onDelete={() => remove(mapping.id)}
          />
        ))}
      </div>

      <AddPathMappingDialog
        connectionId={connectionId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={(mapping) => setMappings((prev) => [mapping, ...prev])}
        sampleAsset={activeSampleAsset}
        suggestedPrefixes={suggestedPrefixes ?? discoveredPrefixes}
        suggestedMounts={suggestedMounts ?? discoveredMounts}
      />
    </section>
  );
}

function pathMappingsBaseUrl(connectionId: string): string {
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}`;
}

function pathMappingsUrl(connectionId: string): string {
  return `${pathMappingsBaseUrl(connectionId)}/path-mappings`;
}

async function verifyMappingCandidate({
  connectionId,
  sampleAsset,
  mapping,
}: {
  connectionId: string;
  sampleAsset: ImmichBridgeAsset;
  mapping: PathMapping;
}): Promise<BridgeVerificationResult> {
  const res = await fetch(`${pathMappingsUrl(connectionId)}/resolve-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...sampleAsset,
      immichPathPrefix: mapping.immichPathPrefix,
      localMountPath: mapping.localMountPath,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as BridgeVerificationResult;
}
