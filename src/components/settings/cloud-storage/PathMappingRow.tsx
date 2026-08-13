import { CheckCircle2, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { PathMapping } from './types';

interface PathMappingRowProps {
  mapping: PathMapping;
  canVerify: boolean;
  verifying: boolean;
  onVerify: () => void;
  onDelete: () => void;
}

export function PathMappingRow({
  mapping,
  canVerify,
  verifying,
  onVerify,
  onDelete,
}: PathMappingRowProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const status = mapping.disabled
    ? s.mappingDisabled
    : mapping.verified
      ? s.mappingVerified
      : s.mappingFailed;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{mapping.immichPathPrefix}</span>
          <span
            className={cn(
              'rounded-md px-2 py-0.5 text-xs font-medium',
              mapping.verified &&
                !mapping.disabled &&
                'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              !mapping.verified &&
                !mapping.disabled &&
                'bg-amber-500/10 text-amber-700 dark:text-amber-300',
              mapping.disabled && 'bg-muted text-muted-foreground',
            )}
          >
            {status}
          </span>
        </div>
        <p className="text-muted-foreground truncate font-mono text-xs">
          {mapping.localMountPath}
        </p>
        {mapping.lastError && (
          <p className="text-destructive text-xs">{mapping.lastError}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canVerify || verifying}
          onClick={onVerify}
          title={canVerify ? undefined : s.verifyNeedsSampleAsset}
        >
          {verifying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {s.verifyMapping}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={s.deleteMapping}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
