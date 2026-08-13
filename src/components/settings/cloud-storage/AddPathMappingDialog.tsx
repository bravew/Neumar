import { useCallback, useMemo, useState } from 'react';

import { CheckCircle2, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import type {
  BridgeVerificationResult,
  ImmichBridgeAsset,
  PathMapping,
} from './types';

interface AddPathMappingDialogProps {
  connectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (mapping: PathMapping) => void;
  suggestedPrefixes?: string[];
  suggestedMounts?: string[];
  sampleAsset?: ImmichBridgeAsset;
}

const INPUT_CLASS =
  'border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-full rounded-md border px-3 text-sm focus:ring-2 focus:outline-none';

export function AddPathMappingDialog({
  connectionId,
  open,
  onOpenChange,
  onSaved,
  suggestedPrefixes = [],
  suggestedMounts = [],
  sampleAsset,
}: AddPathMappingDialogProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const [immichPathPrefix, setImmichPathPrefix] = useState(
    suggestedPrefixes[0] ?? '',
  );
  const [localMountPath, setLocalMountPath] = useState(
    suggestedMounts[0] ?? '',
  );
  const [verifyBeforeSaving, setVerifyBeforeSaving] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canVerify = Boolean(sampleAsset);
  const datalistId = useMemo(
    () => `path-mapping-prefixes-${connectionId}`,
    [connectionId],
  );
  const mountDatalistId = useMemo(
    () => `path-mapping-mounts-${connectionId}`,
    [connectionId],
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      let verified = false;
      let verificationHash: string | undefined;
      let lastError: string | undefined;
      if (verifyBeforeSaving && sampleAsset) {
        const result = await verifyCandidate({
          connectionId,
          sampleAsset,
          immichPathPrefix,
          localMountPath,
        });
        verified = result.verified;
        verificationHash = result.verified
          ? result.verificationHash
          : undefined;
        lastError = result.verified ? undefined : result.reason;
      }

      const res = await fetch(
        `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
          connectionId,
        )}/path-mappings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            immichPathPrefix,
            localMountPath,
            verified,
            verificationHash,
            lastError,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved((await res.json()) as PathMapping);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    connectionId,
    immichPathPrefix,
    localMountPath,
    onOpenChange,
    onSaved,
    sampleAsset,
    verifyBeforeSaving,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.addPathMappingTitle}</DialogTitle>
          <DialogDescription>{s.addPathMappingDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{s.immichPathPrefix}</span>
            <input
              className={INPUT_CLASS}
              value={immichPathPrefix}
              onChange={(event) => setImmichPathPrefix(event.target.value)}
              list={datalistId}
              placeholder="/usr/src/app/external/photos/"
            />
          </label>
          <datalist id={datalistId}>
            {suggestedPrefixes.map((prefix) => (
              <option key={prefix} value={prefix} />
            ))}
          </datalist>

          <label className="space-y-1.5 text-sm">
            <span className="font-medium">{s.localMountPath}</span>
            <input
              className={INPUT_CLASS}
              value={localMountPath}
              onChange={(event) => setLocalMountPath(event.target.value)}
              list={mountDatalistId}
              placeholder="/Volumes/photos"
            />
          </label>
          <datalist id={mountDatalistId}>
            {suggestedMounts.map((mount) => (
              <option key={mount} value={mount} />
            ))}
          </datalist>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={verifyBeforeSaving}
              disabled={!canVerify}
              onChange={(event) => setVerifyBeforeSaving(event.target.checked)}
            />
            <span>
              <span className="block font-medium">{s.verifyBeforeSaving}</span>
              <span className="text-muted-foreground text-xs">
                {canVerify
                  ? s.verifyBeforeSavingHint
                  : s.verifyNeedsSampleAsset}
              </span>
            </span>
          </label>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {s.cancel}
          </Button>
          <Button
            type="button"
            disabled={saving || !immichPathPrefix || !localMountPath}
            onClick={save}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus />}
            {s.saveMapping}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function verifyCandidate({
  connectionId,
  sampleAsset,
  immichPathPrefix,
  localMountPath,
}: {
  connectionId: string;
  sampleAsset: ImmichBridgeAsset;
  immichPathPrefix: string;
  localMountPath: string;
}): Promise<BridgeVerificationResult> {
  const res = await fetch(
    `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
      connectionId,
    )}/path-mappings/resolve-test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...sampleAsset,
        immichPathPrefix,
        localMountPath,
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as BridgeVerificationResult;
}

export function VerifiedIcon() {
  return <CheckCircle2 className="size-4 text-emerald-600" />;
}
