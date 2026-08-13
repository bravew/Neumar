/**
 * PluginInstallDialog — confirms install of a local plugin path.
 *
 * Surfaces:
 *   - manifest summary (name, version, description)
 *   - requested permissions (`metadata.neuma.requires.{anyBins,envVars}`)
 *   - signature status (signed / unsigned warning)
 *   - install errors from the API
 */

import { useEffect, useState } from 'react';

import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PluginManifestLike } from '@/shared/hooks/usePlugins';
import { useLanguage } from '@/shared/providers/language-provider';

interface PluginInstallDialogProps {
  open: boolean;
  /** Local absolute path or a network ref already validated upstream. */
  source: { kind: 'local' | 'github' | 'url'; ref: string };
  manifest: PluginManifestLike | null;
  pending?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PluginInstallDialog({
  open,
  source,
  manifest,
  pending,
  errorMessage,
  onCancel,
  onConfirm,
}: PluginInstallDialogProps) {
  const { t, tt } = useLanguage();
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset the unsigned-acknowledgement when the dialog opens for a new plugin.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open, manifest?.name, manifest?.version]);

  const requires = manifest?.metadata?.neuma?.requires;
  const signature = manifest?.metadata?.neuma?.signature;
  const isSigned = !!signature;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.plugins.actions.install}</DialogTitle>
          <DialogDescription>
            {manifest
              ? tt('plugins.install.confirm', {
                  name: manifest.displayName || manifest.name,
                  version: manifest.version,
                  source: source.kind,
                })
              : null}
          </DialogDescription>
        </DialogHeader>

        {manifest ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{manifest.description}</p>

            <div className="border-border flex items-center gap-2 rounded-md border p-2 text-xs">
              {isSigned ? (
                <>
                  <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
                  <span>{t.plugins.status.signed}</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="size-4 shrink-0 text-amber-500" />
                  <span>{t.plugins.status.unsigned}</span>
                </>
              )}
            </div>

            {requires &&
            ((requires.anyBins?.length ?? 0) > 0 ||
              (requires.envVars?.length ?? 0) > 0) ? (
              <div className="space-y-1.5">
                <p className="text-foreground text-xs font-medium">
                  {t.plugins.install.permissions}
                </p>
                <ul className="text-muted-foreground space-y-1 text-xs">
                  {requires.anyBins?.map((bin) => (
                    <li key={`bin-${bin}`} className="font-mono">
                      bin: {bin}
                    </li>
                  ))}
                  {requires.envVars?.map((env) => (
                    <li key={`env-${env}`} className="font-mono">
                      env: {env}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!isSigned ? (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span className="text-muted-foreground">
                  {t.plugins.install.acknowledgeUnsigned}
                </span>
              </label>
            ) : null}

            {errorMessage ? (
              <p className="text-destructive text-xs" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">…</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending || !manifest || (!isSigned && !acknowledged)}
          >
            {t.plugins.actions.install}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
