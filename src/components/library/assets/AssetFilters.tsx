import { useCallback, useMemo } from 'react';

import {
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Settings2,
  Unlink,
} from 'lucide-react';

import { CloudProviderIcon } from '@/components/library/CloudProviderIcon';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ASSET_KINDS,
  ASSET_SOURCES,
  type AssetKindFilter,
  type AssetQueryState,
  type AssetSource,
  type AssetSourceFilter,
} from '@/shared/assets/types';
import {
  isConfigurableSource,
  useConfiguredAssetSources,
} from '@/shared/assets/useConfiguredSources';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface AssetFiltersProps {
  query: AssetQueryState;
  onChange: (patch: Partial<AssetQueryState>) => void;
  onClear: () => void;
}

export function AssetFilters({ query, onChange, onClear }: AssetFiltersProps) {
  const { t } = useLanguage();
  const s = t.assets;
  const configured = useConfiguredAssetSources();

  // Order rule: always usable first (`all`, `local_fs`, `ai_gen`,
  // unauthenticated stock), then configured cloud/stock providers, then the
  // ones still missing credentials. Inside each band keep the catalogue order
  // from ASSET_SOURCES so the layout stays predictable.
  const sortedSources = useMemo(() => {
    const indexed = ASSET_SOURCES.map((source, idx) => ({ source, idx }));
    return indexed
      .map(({ source, idx }) => ({
        source,
        idx,
        missing: isMissingSource(source, configured),
      }))
      .sort((a, b) => {
        if (a.missing !== b.missing) return a.missing ? 1 : -1;
        return a.idx - b.idx;
      })
      .map((entry) => entry.source);
  }, [configured]);

  const selectedMissing = isMissingSource(query.source, configured);

  // The sidebar shell owns the Settings sheet and listens for the global
  // `open-settings` event (same wiring used by /skills, /mcp, /keyboard).
  // Dispatching with `detail: 'connector'` opens the Connectors tab where
  // the user can OAuth into Drive/Box/Dropbox or paste a stock-catalog
  // API key — same destination the previous `?tab=cloud-storage` link
  // was trying to surface, just inside the settings sheet so the user
  // doesn't leave the Assets view they were filtering.
  const openConnectorSettings = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('open-settings', { detail: 'connector' }),
    );
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ASSET_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={query.kind === kind}
            onClick={() => onChange({ kind })}
            className={cn(
              'border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
              query.kind === kind &&
                'border-primary bg-primary/10 text-primary',
            )}
          >
            <KindIcon kind={kind} />
            {kindLabel(kind, s)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(160px,1fr)_repeat(2,minmax(130px,0.7fr))_auto]">
        <div className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground">{s.source}</span>
          <div className="flex items-center gap-1.5">
            <Select
              value={query.source}
              onValueChange={(value) =>
                onChange({ source: value as AssetSourceFilter })
              }
            >
              <SelectTrigger className="focus:border-muted-foreground/40 focus:ring-muted-foreground/25 data-[state=open]:border-muted-foreground/40 data-[state=open]:ring-muted-foreground/25 h-9 flex-1 text-sm focus:ring-1 focus:ring-offset-0 data-[state=open]:ring-1">
                <SelectValue>
                  <span className="flex min-w-0 items-center gap-2">
                    <SourceIcon source={query.source} />
                    <span className="truncate">
                      {sourceLabel(query.source, s)}
                    </span>
                    {selectedMissing ? (
                      <Unlink
                        className="text-muted-foreground size-3.5 shrink-0"
                        aria-label={s.sourceNotConfigured}
                      />
                    ) : null}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sortedSources.map((source) => (
                  <SelectItem key={source} value={source}>
                    <SourceOption
                      source={source}
                      label={sourceLabel(source, s)}
                      notConfigured={isMissingSource(source, configured)}
                      notConfiguredLabel={s.sourceNotConfigured}
                    />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              title={s.configureSources}
              aria-label={s.configureSources}
              onClick={openConnectorSettings}
            >
              <Settings2 className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <label className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground">{s.tags}</span>
          <input
            value={query.tags}
            onChange={(event) => onChange({ tags: event.target.value })}
            placeholder={s.tagsPlaceholder}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          />
        </label>

        <label className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground">{s.from}</span>
          <input
            type="date"
            value={query.from}
            onChange={(event) => onChange({ from: event.target.value })}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          />
        </label>

        <label className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground">{s.to}</span>
          <input
            type="date"
            value={query.to}
            onChange={(event) => onChange({ to: event.target.value })}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          />
        </label>

        <div className="flex items-end">
          <Button type="button" variant="outline" onClick={onClear}>
            {s.clearFilters}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourceOption({
  source,
  label,
  notConfigured,
  notConfiguredLabel,
}: {
  source: AssetSourceFilter;
  label: string;
  notConfigured: boolean;
  notConfiguredLabel: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <SourceIcon source={source} />
      <span className="truncate">{label}</span>
      {notConfigured ? (
        <Unlink
          className="text-muted-foreground ml-auto size-3.5 shrink-0 opacity-80"
          aria-label={notConfiguredLabel}
        >
          <title>{notConfiguredLabel}</title>
        </Unlink>
      ) : null}
    </span>
  );
}

function SourceIcon({ source }: { source: AssetSourceFilter }) {
  if (source === 'all') {
    return (
      <File className="text-muted-foreground size-4 shrink-0" aria-hidden />
    );
  }
  if (source === 'local_fs') {
    return (
      <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
    );
  }
  if (source === 'ai_gen') {
    return (
      <FileImage
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    );
  }
  return <CloudProviderIcon provider={source} />;
}

function isMissingSource(
  source: AssetSourceFilter,
  configured: Set<AssetSource> | null,
): boolean {
  if (source === 'all') return false;
  if (!isConfigurableSource(source)) return false;
  if (configured === null) return false;
  return !configured.has(source);
}

function KindIcon({ kind }: { kind: AssetKindFilter }) {
  const className = 'size-4';
  if (kind === 'image') return <FileImage className={className} aria-hidden />;
  if (kind === 'video') return <FileVideo className={className} aria-hidden />;
  if (kind === 'audio') return <FileAudio className={className} aria-hidden />;
  if (kind === 'pdf' || kind === 'text' || kind === 'doc') {
    return <FileText className={className} aria-hidden />;
  }
  return <File className={className} aria-hidden />;
}

function kindLabel(kind: AssetKindFilter, s: Record<string, string>): string {
  const labels: Record<AssetKindFilter, string> = {
    all: s.allKinds,
    image: s.kindImage,
    video: s.kindVideo,
    audio: s.kindAudio,
    pdf: s.kindPdf,
    text: s.kindText,
    doc: s.kindDoc,
    other: s.kindOther,
  };
  return labels[kind];
}

function sourceLabel(
  source: AssetSourceFilter,
  s: Record<string, string>,
): string {
  const labels: Record<AssetSourceFilter, string> = {
    all: s.allSources,
    local_fs: s.sourceLocalFs,
    ai_gen: s.sourceAiGen,
    immich: s.sourceImmich,
    photoprism: s.sourcePhotoprism,
    google_drive: s.sourceGoogleDrive,
    dropbox: s.sourceDropbox,
    box: s.sourceBox,
    onedrive: s.sourceOnedrive,
    s3_compatible: s.sourceS3,
    openverse: s.sourceOpenverse,
    unsplash: s.sourceUnsplash,
    pexels: s.sourcePexels,
    pixabay: s.sourcePixabay,
    coverr: s.sourceCoverr,
    videvo: s.sourceVidevo,
  };
  return labels[source];
}
