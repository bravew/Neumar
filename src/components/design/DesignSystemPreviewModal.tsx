import { useEffect, useState } from 'react';

import {
  Check,
  Download,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateDesignSystemCatalogPack } from '@/shared/hooks/useDesignMode';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { DesignSystemShareMenu } from './DesignSystemShareMenu';
import {
  DesignSystemReferenceView,
  DesignSystemShowcaseView,
} from './DesignSystemShowcaseView';
import { DesignSystemSpecView } from './DesignSystemSpecView';
import { DesignSystemTokensView } from './DesignSystemTokensView';

export function DesignSystemPreviewModal({
  system,
  selected,
  installPending,
  startPending,
  installError,
  onOpenChange,
  onInstallChange,
  onSelectDefault,
  onStartProject,
  onCatalogChanged,
}: {
  system: DesignSystemRecord | null;
  selected: boolean;
  installPending: boolean;
  startPending?: boolean;
  installError?: string;
  onOpenChange: (open: boolean) => void;
  onInstallChange: (system: DesignSystemRecord) => void;
  onSelectDefault: (system: DesignSystemRecord) => void;
  onStartProject?: (system: DesignSystemRecord) => void;
  onCatalogChanged?: () => void;
}) {
  const { t } = useLanguage();
  const [activeView, setActiveView] = useState<
    'showcase' | 'reference' | 'tokens'
  >('showcase');
  const [sourceOpen, setSourceOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renamePending, setRenamePending] = useState(false);
  const [renameError, setRenameError] = useState('');

  useEffect(() => {
    setRenaming(false);
    setRenameTitle(system?.title ?? '');
    setRenameError('');
  }, [system?.id, system?.title]);

  const submitRename = async () => {
    if (!system) return;
    setRenamePending(true);
    setRenameError('');
    try {
      await updateDesignSystemCatalogPack(system.id, { title: renameTitle });
      onCatalogChanged?.();
      onOpenChange(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenamePending(false);
    }
  };

  return (
    <Dialog
      open={Boolean(system)}
      onOpenChange={(open) => {
        if (!open) {
          setShareOpen(false);
          setFullscreen(false);
        }
        onOpenChange(open);
      }}
    >
      <DialogContent
        className={cn(
          'h-[88vh] max-h-[920px] gap-0 overflow-hidden p-0 sm:max-w-[min(94vw,1320px)]',
          fullscreen &&
            'h-[calc(100vh-2rem)] max-h-none sm:max-w-[calc(100vw-2rem)]',
        )}
        data-testid="design-system-preview-modal"
      >
        {system && (
          <div className="flex min-h-0 flex-col">
            <header className="border-border flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-4 pr-12">
              <DialogHeader className="min-w-60 flex-1">
                <DialogTitle>{system.title}</DialogTitle>
                <DialogDescription>
                  {system.summary || t.design.designSystemPreview}
                </DialogDescription>
              </DialogHeader>
              <div
                className="bg-muted flex rounded-full border p-1"
                role="tablist"
              >
                <ViewTab
                  active={activeView === 'showcase'}
                  onClick={() => setActiveView('showcase')}
                >
                  {t.design.showcase}
                </ViewTab>
                <ViewTab
                  active={activeView === 'reference'}
                  onClick={() => setActiveView('reference')}
                >
                  {t.design.reference}
                </ViewTab>
                <ViewTab
                  active={activeView === 'tokens'}
                  onClick={() => setActiveView('tokens')}
                >
                  {t.design.tokens}
                </ViewTab>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={sourceOpen ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSourceOpen((open) => !open)}
                  data-testid="design-system-source-toggle"
                >
                  DESIGN.md
                </Button>
                {system.editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRenaming((value) => !value)}
                    data-testid="design-system-preview-rename"
                  >
                    <Pencil className="size-4" />
                    {t.design.renameDesignSystem}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFullscreen((value) => !value)}
                  data-testid="design-system-fullscreen"
                >
                  {fullscreen ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                  {fullscreen ? t.design.exitFullscreen : t.design.fullscreen}
                </Button>
                <div className="relative">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-haspopup="menu"
                    aria-expanded={shareOpen}
                    onClick={() => setShareOpen((open) => !open)}
                    data-testid="design-system-share"
                  >
                    {t.design.share}
                  </Button>
                  {shareOpen && (
                    <DesignSystemShareMenu
                      system={system}
                      activeView={activeView}
                      onClose={() => setShareOpen(false)}
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant={selected ? 'secondary' : 'default'}
                  size="sm"
                  onClick={() => onSelectDefault(system)}
                  disabled={selected}
                >
                  <Check className="size-4" />
                  {selected
                    ? t.design.defaultDesignSystem
                    : t.design.useAsDefaultDesignSystem}
                </Button>
                {onStartProject && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={startPending}
                    data-testid="design-system-preview-start"
                    onClick={() => onStartProject(system)}
                  >
                    <Plus className="size-4" />
                    {t.design.startDesignSystemProject}
                  </Button>
                )}
                {(system.origin !== 'installed' || system.canUninstall) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onInstallChange(system)}
                    disabled={installPending}
                  >
                    {system.canUninstall ? (
                      <Trash2 className="size-4" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {installPending
                      ? t.design.catalogUpdating
                      : system.canUninstall
                        ? t.design.catalogUninstall
                        : t.design.catalogInstall}
                  </Button>
                )}
              </div>
              {installError && (
                <p className="text-destructive basis-full text-sm">
                  {installError}
                </p>
              )}
              {renaming && (
                <form
                  className="basis-full"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitRename();
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={renameTitle}
                      onChange={(event) => setRenameTitle(event.target.value)}
                      className="border-input bg-background focus:ring-ring/40 h-9 min-w-64 flex-1 rounded-md border px-3 text-sm outline-none focus:ring-2"
                      data-testid="design-system-preview-rename-input"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!renameTitle.trim() || renamePending}
                    >
                      {t.common.save}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRenaming(false)}
                    >
                      {t.common.cancel}
                    </Button>
                  </div>
                  {renameError && (
                    <p className="text-destructive mt-2 text-sm">
                      {renameError}
                    </p>
                  )}
                </form>
              )}
            </header>
            <div
              className={cn(
                'min-h-0 flex-1',
                sourceOpen
                  ? 'grid lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]'
                  : 'grid grid-cols-1',
              )}
            >
              <section className="min-h-0 overflow-auto bg-white">
                {activeView === 'showcase' ? (
                  <DesignSystemShowcaseView
                    system={system}
                    testId={`design-system-showcase-${system.id}`}
                  />
                ) : activeView === 'reference' ? (
                  <DesignSystemReferenceView
                    system={system}
                    testId={`design-system-reference-${system.id}`}
                  />
                ) : (
                  <DesignSystemTokensView
                    system={system}
                    testId={`design-system-tokens-${system.id}`}
                  />
                )}
              </section>
              {sourceOpen && (
                <aside className="border-border bg-background hidden min-h-0 border-l lg:flex lg:flex-col">
                  <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
                    <h3 className="text-sm font-medium">DESIGN.md</h3>
                    <span className="text-muted-foreground text-xs">
                      {system.category}
                    </span>
                  </div>
                  <DesignSystemSpecView
                    body={system.body}
                    testId={`design-system-spec-${system.id}`}
                  />
                </aside>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Pill tab in the Showcase / Reference / Tokens switcher. */
function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'rounded-full px-5 py-2 text-sm font-medium',
        active ? 'bg-background shadow-sm' : 'text-muted-foreground',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
