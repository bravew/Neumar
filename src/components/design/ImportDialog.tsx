import { useState } from 'react';

import { FolderOpen, UploadCloud } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { importDesignProject } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignImportReportItem,
  DesignProject,
  DesignSurface,
} from '@/shared/types/design-mode';

export function ImportDialog({
  open,
  onOpenChange,
  surface,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: DesignSurface;
  onImported: (project: DesignProject) => void;
}) {
  const { t } = useLanguage();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [report, setReport] = useState<DesignImportReportItem[]>([]);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [allowLintOverride, setAllowLintOverride] = useState(false);
  const selectedLabel =
    files.length === 0
      ? ''
      : files.length === 1
        ? files[0]?.name
        : t.design.importSelectedFiles.replace('{count}', String(files.length));
  const hasBlockingLint = report.some(
    (item) => item.status === 'error' && item.rule.startsWith('lint.'),
  );

  const runImport = async () => {
    if (files.length === 0) {
      setError(t.design.importNoFile);
      return;
    }
    setImporting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.set('surface', surface);
      if (allowLintOverride) formData.set('allowLintOverride', 'true');
      if (title.trim()) formData.set('title', title.trim());
      const archiveFile =
        files.length === 1 && isZipPath(files[0]!.name) ? files[0] : null;
      if (archiveFile) {
        formData.set('archiveName', archiveFile.name);
        formData.set('archive', archiveFile, archiveFile.name);
      } else {
        formData.set(
          'archiveName',
          files.length === 1 ? files[0]!.name : `${files.length} files`,
        );
        const importFiles = files.map((item) => ({
          file: item,
          path: importFilePath(item),
        }));
        const entrypoint = importFiles.find((item) =>
          item.path.toLowerCase().endsWith('.html'),
        )?.path;
        if (entrypoint) formData.set('entrypoint', entrypoint);
        importFiles.forEach(({ file: item, path }) => {
          formData.append('files', item, path);
        });
      }
      const result = await importDesignProject(formData);
      setReport(result.report ?? []);
      if (result.project) {
        onImported(result.project);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.design.importTitle}</DialogTitle>
          <DialogDescription>{t.design.importDescription}</DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">{t.design.importProjectTitle}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t.design.importProjectTitlePlaceholder}
            className="border-input h-10 rounded-md border px-3"
          />
        </label>
        <div
          className="border-border hover:bg-accent/40 rounded-md border border-dashed p-4 text-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            setSelectedFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3">
              <UploadCloud className="text-muted-foreground size-4" />
              <span>{t.design.importChooseFile}</span>
              <input
                type="file"
                accept=".zip,.html,.htm,text/html,application/zip"
                className="sr-only"
                onChange={(event) => {
                  setSelectedFiles(Array.from(event.target.files ?? []));
                }}
              />
            </label>
            <label className="border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3">
              <FolderOpen className="text-muted-foreground size-4" />
              <span>{t.design.importChooseFolder}</span>
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  setSelectedFiles(Array.from(event.target.files ?? []));
                }}
                {...directoryInputProps}
              />
            </label>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            {t.design.importDropHint}
          </p>
          {selectedLabel && (
            <p className="text-muted-foreground mt-2 truncate text-xs">
              {t.design.importSelectedFile}: {selectedLabel}
            </p>
          )}
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {report.length > 0 && (
          <div className="rounded-md border p-3">
            <h3 className="text-sm font-medium">{t.design.importReport}</h3>
            <ul className="mt-2 space-y-1 text-xs">
              {report.map((item) => (
                <li
                  key={`${item.rule}-${item.message}`}
                  className={statusClass(item.status)}
                >
                  {item.status.toUpperCase()} · {item.rule}: {item.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {hasBlockingLint && (
          <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={allowLintOverride}
              onChange={(event) => setAllowLintOverride(event.target.checked)}
            />
            <span>
              <span className="block font-medium">
                {t.design.importAllowLintOverride}
              </span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {t.design.importAllowLintOverrideDescription}
              </span>
            </span>
          </label>
        )}
        <Button
          type="button"
          onClick={runImport}
          disabled={importing || files.length === 0}
          className="w-full"
        >
          {importing
            ? t.design.importing
            : hasBlockingLint && allowLintOverride
              ? t.design.importRetryWithOverride
              : t.design.importCreate}
        </Button>
      </DialogContent>
    </Dialog>
  );

  function setSelectedFiles(next: File[]) {
    setReport([]);
    setError('');
    setAllowLintOverride(false);
    setFiles(next);
  }
}

function statusClass(status: DesignImportReportItem['status']) {
  if (status === 'error') return 'text-destructive';
  if (status === 'warn') return 'text-amber-700 dark:text-amber-300';
  return 'text-muted-foreground';
}

function importFilePath(file: File) {
  return (
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name
  );
}

function isZipPath(filePath: string) {
  return /\.zip$/i.test(filePath);
}

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as Record<string, string>;
