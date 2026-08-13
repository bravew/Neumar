import {
  ChevronDown,
  CloudUpload,
  FilePlus,
  FolderPlus,
  Images,
  Library,
  Plus,
  Sparkles,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

interface ProjectAssetsHeaderProps {
  labels: {
    projectAssets: string;
    browseProjectAssets: string;
    addFiles: string;
    addFolder: string;
    addAssets: string;
    connectCloud: string;
    inContext: string;
    inContextHint: string;
  };
  browseCatalogLabel: string;
  newCount: number;
  uniqueProjectAssetCount: number;
  contextCount: number;
  contextOnly: boolean;
  addingFolder: boolean;
  addingFiles: boolean;
  onOpenBrowser: () => void;
  onOpenCatalog: () => void;
  onAddLocalFiles: () => void;
  onAddLocalFolder: () => void;
  onConnectCloud: () => void;
  onToggleContextOnly: () => void;
}

export function ProjectAssetsHeader({
  labels,
  browseCatalogLabel,
  newCount,
  uniqueProjectAssetCount,
  contextCount,
  contextOnly,
  addingFolder,
  addingFiles,
  onOpenBrowser,
  onOpenCatalog,
  onAddLocalFiles,
  onAddLocalFolder,
  onConnectCloud,
  onToggleContextOnly,
}: ProjectAssetsHeaderProps) {
  return (
    <header className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
        <h3 className="text-foreground flex min-w-0 items-center gap-1 text-xs font-semibold">
          <span className="truncate">{labels.projectAssets}</span>
          {newCount > 0 ? (
            <span className="bg-primary text-primary-foreground inline-flex items-center gap-0.5 rounded-sm px-1 text-[9px] font-semibold uppercase">
              <Sparkles className="size-2.5" />
              {newCount}
            </span>
          ) : null}
          {contextCount > 0 ? (
            <button
              type="button"
              onClick={onToggleContextOnly}
              aria-pressed={contextOnly}
              title={labels.inContextHint}
              className={cn(
                'inline-flex items-center rounded-sm border px-1 text-[9px] font-medium tabular-nums transition-colors',
                contextOnly
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {labels.inContext.replace('{count}', String(contextCount))}
            </button>
          ) : null}
        </h3>
        <TooltipProvider delayDuration={200}>
          <div className="flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2"
                >
                  <Plus className="size-3.5" aria-hidden />
                  {labels.addAssets}
                  <ChevronDown className="size-3 opacity-70" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem
                  className="gap-2"
                  disabled={addingFiles}
                  onSelect={onAddLocalFiles}
                >
                  <FilePlus className="size-3.5" aria-hidden />
                  {labels.addFiles}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  disabled={addingFolder}
                  onSelect={onAddLocalFolder}
                >
                  <FolderPlus className="size-3.5" aria-hidden />
                  {labels.addFolder}
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onSelect={onConnectCloud}>
                  <CloudUpload className="size-3.5" aria-hidden />
                  {labels.connectCloud}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2" onSelect={onOpenCatalog}>
                  <Library className="size-3.5" aria-hidden />
                  {browseCatalogLabel}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpenBrowser}
                  className="border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted hover:text-foreground focus-visible:ring-primary/40 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2"
                  aria-label={labels.browseProjectAssets}
                >
                  <Images className="size-3.5" aria-hidden />
                  <span className="tabular-nums">
                    {uniqueProjectAssetCount}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {labels.browseProjectAssets}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </header>
  );
}
