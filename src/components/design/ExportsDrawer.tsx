import { useEffect, useMemo, useState } from 'react';

import {
  AlertTriangle,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  buildDesignPdfExportInput,
  DesignApiError,
  designBlobUrl,
  exportDesignProject,
  getDesignFileLocation,
  getDesignDependencies,
  listDesignExports,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignDependencyStatus,
  DesignExportRecord,
  DesignSurface,
} from '@/shared/types/design-mode';
import { classifyExportError } from '@/shared/utils/export-error';

import {
  DependencyRow,
  dependencyStatuses,
  exportFormats,
  formatBytes,
} from './export-drawer-helpers';
import { printArtifactPdfInput } from './pdf-print';

export function ExportsDrawer({
  open,
  onOpenChange,
  projectId,
  surface,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  surface: DesignSurface;
}) {
  const { t } = useLanguage();
  const formats = useMemo(() => exportFormats(surface), [surface]);
  const [format, setFormat] = useState(formats[0]);
  const [exports, setExports] = useState<DesignExportRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [errorDependency, setErrorDependency] = useState('');
  const [blockedByLint, setBlockedByLint] = useState(false);
  const [allowLintOverride, setAllowLintOverride] = useState(false);
  const [copiedExportId, setCopiedExportId] = useState('');
  const [reexportingId, setReexportingId] = useState('');
  const [dependencies, setDependencies] = useState<DesignDependencyStatus[]>(
    [],
  );
  const selectedDependencies = useMemo(
    () => dependencyStatuses(surface, format, dependencies),
    [dependencies, format, surface],
  );

  useEffect(() => {
    setFormat(formats[0]);
  }, [formats]);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    Promise.all([
      listDesignExports(projectId, { signal: ac.signal }),
      getDesignDependencies({ signal: ac.signal }),
    ])
      .then(([exportResult, dependencyResult]) => {
        setExports(exportResult.exports);
        setDependencies(dependencyResult.dependencies);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setExports([]);
        setDependencies([]);
      });
    return () => ac.abort();
  }, [open, projectId]);

  const runExport = async () => {
    setExporting(true);
    setError('');
    setErrorDependency('');
    setBlockedByLint(false);
    toast.success(t.design.exportStarted);
    try {
      const result = await exportDesignProject(projectId, format, {
        allowLintOverride,
      });
      setExports((prev) => [result.export, ...prev]);
    } catch (err) {
      try {
        if (await maybePrintPdfFallback(err, projectId, format)) return;
      } catch (fallbackErr) {
        setError(
          fallbackErr instanceof Error
            ? fallbackErr.message
            : String(fallbackErr),
        );
        return;
      }
      const classified = classifyExportError(err);
      setError(classified.message);
      setErrorDependency(classified.dependency ?? '');
      setBlockedByLint(classified.code === 'export_blocked_by_lint');
    } finally {
      setExporting(false);
    }
  };

  const copyPath = async (item: DesignExportRecord) => {
    await navigator.clipboard?.writeText(item.path);
    setCopiedExportId(item.id);
  };

  const revealExport = async (item: DesignExportRecord) => {
    const location = await getDesignFileLocation(projectId, item.path);
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(parentDirectory(location.absolutePath));
    } catch {
      await navigator.clipboard?.writeText(location.absolutePath);
      setCopiedExportId(item.id);
    }
  };

  const reExport = async (item: DesignExportRecord) => {
    setReexportingId(item.id);
    setError('');
    setErrorDependency('');
    toast.success(t.design.exportStarted);
    try {
      const result = await exportDesignProject(projectId, item.format, {
        allowLintOverride,
      });
      setExports((prev) => [result.export, ...prev]);
    } catch (err) {
      const classified = classifyExportError(err);
      setError(classified.message);
      setErrorDependency(classified.dependency ?? '');
    } finally {
      setReexportingId('');
    }
  };

  const maybePrintPdfFallback = async (
    err: unknown,
    currentProjectId: string,
    currentFormat: string,
  ) => {
    if (
      currentFormat !== 'pdf' ||
      !(err instanceof DesignApiError) ||
      !['playwright', 'pandoc'].includes(String(err.data.dependency ?? ''))
    ) {
      return false;
    }
    const result = await buildDesignPdfExportInput(currentProjectId, {
      deck: surface === 'deck',
    });
    await printArtifactPdfInput(result.buildInput);
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.design.exportTitle}</DialogTitle>
          <DialogDescription>{t.design.exportDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t.design.exportFormat}</span>
          <div className="flex flex-wrap gap-2">
            {formats.map((item) => (
              <button
                key={item}
                type="button"
                className="data-[active=true]:border-primary data-[active=true]:bg-primary/10 rounded-md border px-3 py-1.5 text-sm"
                data-active={format === item}
                onClick={() => setFormat(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {selectedDependencies.length > 0 && (
          <section className="rounded-md border p-3">
            <h3 className="text-sm font-medium">
              {t.design.exportDependencies}
            </h3>
            <div className="mt-2 space-y-2">
              {selectedDependencies.map((dependency) => (
                <DependencyRow key={dependency.id} dependency={dependency} />
              ))}
            </div>
          </section>
        )}
        {error && (
          <div className="text-destructive flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>{error}</p>
              {errorDependency && (
                <p className="mt-1 text-xs">
                  {t.design.exportMissingDependency.replace(
                    '{dependency}',
                    errorDependency,
                  )}
                </p>
              )}
            </div>
          </div>
        )}
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={allowLintOverride}
            onChange={(event) => setAllowLintOverride(event.target.checked)}
          />
          <span>
            <span className="block font-medium">
              {t.design.exportAllowLintOverride}
            </span>
            <span className="text-muted-foreground mt-1 block text-xs">
              {t.design.exportAllowLintOverrideDescription}
            </span>
          </span>
        </label>
        <Button type="button" onClick={runExport} disabled={exporting}>
          <Download className="size-4" />
          {exporting
            ? t.design.exporting
            : blockedByLint && allowLintOverride
              ? t.design.exportRetryWithOverride
              : t.design.export}
        </Button>
        <section className="rounded-md border p-3">
          <h3 className="text-sm font-medium">{t.design.existingExports}</h3>
          {exports.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {t.design.noExports}
            </p>
          ) : (
            <ol className="mt-2 space-y-2 text-sm">
              {exports.map((item) => (
                <li key={item.id} className="rounded-md border p-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">
                      {item.format.toUpperCase()}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatBytes(item.size)}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {item.path}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={designBlobUrl(projectId, item.path)}
                      target="_blank"
                      rel="noreferrer"
                      className="border-input hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs"
                    >
                      <ExternalLink className="size-3.5" />
                      {t.design.exportOpen}
                    </a>
                    <button
                      type="button"
                      className="border-input hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs"
                      onClick={() => void revealExport(item)}
                    >
                      <FolderOpen className="size-3.5" />
                      {t.design.exportReveal}
                    </button>
                    <button
                      type="button"
                      className="border-input hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs"
                      onClick={() => void copyPath(item)}
                    >
                      <Copy className="size-3.5" />
                      {copiedExportId === item.id
                        ? t.design.exportCopiedPath
                        : t.design.exportCopyPath}
                    </button>
                    <button
                      type="button"
                      className="border-input hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs disabled:opacity-60"
                      disabled={reexportingId === item.id}
                      onClick={() => void reExport(item)}
                    >
                      <RotateCcw className="size-3.5" />
                      {t.design.exportReExport}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function parentDirectory(filePath: string) {
  const trimmed = filePath.replace(/[\\/]+$/, '');
  const lastSeparator = Math.max(
    trimmed.lastIndexOf('/'),
    trimmed.lastIndexOf('\\'),
  );
  return lastSeparator > 0 ? trimmed.slice(0, lastSeparator) : filePath;
}
