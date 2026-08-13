import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignAssetVersion } from '@/shared/types/design-mode';

export function VersionTimeline({
  versions,
  primaryPath,
  onOpen,
  onCompare,
  onPromote,
}: {
  versions: DesignAssetVersion[];
  primaryPath?: string;
  onOpen: (path: string) => void;
  onCompare: (version: DesignAssetVersion) => void;
  onPromote: (version: DesignAssetVersion) => void;
}) {
  const { t } = useLanguage();
  if (versions.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
        {t.design.noVersions}
      </p>
    );
  }
  return (
    <ol className="space-y-2 text-sm">
      {versions.map((version, index) => {
        const isPrimary = version.path === primaryPath;
        return (
          <li
            key={`${version.path}-${index}`}
            className="rounded-md border p-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  v{versions.length - index} · {version.path}
                </p>
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {version.provider ?? t.design.providerLocal} ·{' '}
                  {version.model ?? t.design.modelAuto} ·{' '}
                  {formatDate(version.createdAt)}
                </p>
              </div>
              {isPrimary && (
                <span className="bg-primary/10 text-primary rounded px-2 py-1 text-xs">
                  {t.design.primaryVersion}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpen(version.path)}
              >
                {t.design.openAsset}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onCompare(version)}
              >
                {t.design.compare}
              </Button>
              {!isPrimary && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onPromote(version)}
                >
                  {t.design.useAsPrimary}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
