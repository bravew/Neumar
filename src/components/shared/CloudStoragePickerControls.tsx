import {
  Check,
  ChevronDown,
  ChevronRight,
  Home,
  List,
  Rows,
  Search,
  SlidersHorizontal,
} from 'lucide-react';

import {
  CloudProviderIcon,
  LicenseFilter,
  type StockLicenseCode,
} from '@/components/library';
import {
  MEDIA_KINDS,
  type CloudFile,
  type CloudStorageConnection,
  type MediaKind,
} from '@/components/library/cloudStorageLibraryUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';

import { KindIcon, kindLabel } from './cloudStoragePickerUtils';

interface CloudStoragePickerControlsProps {
  connections: CloudStorageConnection[];
  selectedConnectionId: string;
  query: string;
  kind: MediaKind;
  licenses: StockLicenseCode[];
  folderStack: CloudFile[];
  showMediaFilters: boolean;
  showLicenseFilter: boolean;
  showAdvancedFilters?: boolean;
  hasActiveFilters?: boolean;
  viewMode?: 'grid' | 'list';
  strings: Record<string, string>;
  onConnectionChange: (connectionId: string) => void;
  onQueryChange: (query: string) => void;
  onKindChange: (kind: MediaKind) => void;
  onLicensesChange: (licenses: StockLicenseCode[]) => void;
  /**
   * Pop the folder stack to `depth` items (depth=0 → root). Replaces
   * the previous one-step `onNavigateUp` so breadcrumb clicks can jump
   * to any ancestor.
   */
  onNavigateToDepth: (depth: number) => void;
  onOpenAdvancedFilters?: () => void;
  onViewModeChange?: (mode: 'grid' | 'list') => void;
}

export function CloudStoragePickerControls({
  connections,
  selectedConnectionId,
  query,
  kind,
  licenses,
  folderStack,
  showMediaFilters,
  showLicenseFilter,
  showAdvancedFilters,
  hasActiveFilters,
  strings,
  viewMode,
  onConnectionChange,
  onQueryChange,
  onKindChange,
  onLicensesChange,
  onNavigateToDepth,
  onOpenAdvancedFilters,
  onViewModeChange,
}: CloudStoragePickerControlsProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {connections.length > 1 ? (
        <ConnectionDropdown
          connections={connections}
          selectedConnectionId={selectedConnectionId}
          onChange={onConnectionChange}
          label={strings.cloudStoragePickerTitle}
        />
      ) : connections[0] ? (
        <span className="text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border-transparent px-1 text-xs font-medium">
          <CloudProviderIcon
            provider={connections[0].provider}
            className="size-4"
          />
          {connections[0].displayName || connections[0].provider}
        </span>
      ) : null}

      <label className="border-input bg-background flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 text-xs">
        <Search className="text-muted-foreground size-3.5" aria-hidden />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={strings.mediaSearchPlaceholder}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>

      {showAdvancedFilters && onOpenAdvancedFilters ? (
        <button
          type="button"
          aria-label={strings.searchOptions}
          title={strings.searchOptions}
          onClick={onOpenAdvancedFilters}
          className={cn(
            'border-border text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md border transition-colors',
            hasActiveFilters && 'border-primary bg-primary/10 text-primary',
          )}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </button>
      ) : null}

      {showMediaFilters ? (
        <div className="flex items-center gap-1">
          {MEDIA_KINDS.map((nextKind) => (
            <button
              key={nextKind}
              type="button"
              aria-pressed={kind === nextKind}
              aria-label={kindLabel(nextKind, strings)}
              title={kindLabel(nextKind, strings)}
              onClick={() => onKindChange(nextKind)}
              className={cn(
                'border-border text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md border transition-colors',
                kind === nextKind &&
                  'border-primary bg-primary/10 text-primary',
              )}
            >
              <KindIcon kind={nextKind} />
            </button>
          ))}
        </div>
      ) : null}

      {showLicenseFilter ? (
        <LicenseFilter value={licenses} onChange={onLicensesChange} />
      ) : null}

      {onViewModeChange ? (
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-pressed={viewMode !== 'list'}
            aria-label={strings.viewGrid}
            title={strings.viewGrid}
            onClick={() => onViewModeChange('grid')}
            className={cn(
              'border-border text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md border transition-colors',
              viewMode !== 'list' &&
                'border-primary bg-primary/10 text-primary',
            )}
          >
            <Rows className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'list'}
            aria-label={strings.viewList}
            title={strings.viewList}
            onClick={() => onViewModeChange('list')}
            className={cn(
              'border-border text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md border transition-colors',
              viewMode === 'list' &&
                'border-primary bg-primary/10 text-primary',
            )}
          >
            <List className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {folderStack.length > 0 ? (
        <nav
          aria-label={strings.folderPathLabel}
          className="flex w-full min-w-0 items-center gap-1 overflow-x-auto text-xs"
        >
          <button
            type="button"
            onClick={() => onNavigateToDepth(0)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded px-1.5 py-1"
            title={strings.folderRoot}
          >
            <Home className="size-3.5" aria-hidden />
            <span>{strings.folderRoot}</span>
          </button>
          {folderStack.map((folder, index) => {
            const isLast = index === folderStack.length - 1;
            return (
              <span key={folder.id} className="flex items-center gap-1">
                <ChevronRight
                  className="text-muted-foreground/60 size-3.5"
                  aria-hidden
                />
                {isLast ? (
                  <span
                    aria-current="page"
                    className="text-foreground max-w-[160px] truncate px-1.5 py-1 text-xs font-medium"
                    title={folder.name}
                  >
                    {folder.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigateToDepth(index + 1)}
                    className="text-muted-foreground hover:text-foreground max-w-[160px] truncate rounded px-1.5 py-1"
                    title={folder.name}
                  >
                    {folder.name}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

function ConnectionDropdown({
  connections,
  selectedConnectionId,
  onChange,
  label,
}: {
  connections: CloudStorageConnection[];
  selectedConnectionId: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const current =
    connections.find((c) => c.id === selectedConnectionId) ?? connections[0];
  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="border-input bg-background hover:bg-muted/40 inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium"
      >
        <CloudProviderIcon provider={current.provider} className="size-4" />
        <span className="max-w-[160px] truncate">
          {current.displayName || current.provider}
        </span>
        <ChevronDown className="text-muted-foreground size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {connections.map((connection) => {
          const isActive = connection.id === selectedConnectionId;
          return (
            <DropdownMenuItem
              key={connection.id}
              onSelect={() => onChange(connection.id)}
              className="flex items-center gap-2 text-xs"
            >
              <CloudProviderIcon
                provider={connection.provider}
                className="size-4"
              />
              <span className="flex-1 truncate">
                {connection.displayName || connection.provider}
              </span>
              {isActive ? (
                <Check className="text-primary size-3.5" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
