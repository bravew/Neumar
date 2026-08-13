import { useMemo } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  type BackupV1,
  type ImportResult,
  validateBackupV1,
} from '@/shared/db/backup-schema';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: unknown | null;
  result: ImportResult | null;
  busy: boolean;
  onConfirm: (data: BackupV1) => void;
}

export function DataImportPreviewDialog({
  open,
  onOpenChange,
  payload,
  result,
  busy,
  onConfirm,
}: Props) {
  const { t } = useLanguage();
  const s = (t.settings ?? {}) as Record<string, string>;

  const validation = useMemo(() => {
    if (!payload) return { ok: false, errors: [] as string[], data: null };
    return validateBackupV1(payload);
  }, [payload]);

  const counts = validation.data
    ? {
        sessions: validation.data.sessions.length,
        tasks: validation.data.tasks.length,
        messages: validation.data.messages.length,
        files: validation.data.files.length,
        settings: validation.data.settings
          ? Object.keys(validation.data.settings).length
          : 0,
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {s.dataImportPreviewTitle ?? 'Review backup before import'}
          </DialogTitle>
          <DialogDescription>
            {s.dataImportPreviewDescription ??
              'Existing rows with the same id will be updated; new rows will be inserted.'}
          </DialogDescription>
        </DialogHeader>

        {validation.ok && counts && !result && (
          <ul className="text-foreground/80 space-y-1 text-sm">
            <li>
              {s.dataImportSessions ?? 'Sessions'}: {counts.sessions}
            </li>
            <li>
              {s.dataImportTasks ?? 'Tasks'}: {counts.tasks}
            </li>
            <li>
              {s.dataImportMessages ?? 'Messages'}: {counts.messages}
            </li>
            <li>
              {s.dataImportFiles ?? 'Files'}: {counts.files}
            </li>
            <li>
              {s.dataImportSettingsRows ?? 'Settings'}: {counts.settings}
            </li>
          </ul>
        )}

        {!validation.ok && (
          <div className="text-sm text-red-600">
            <p className="font-medium">
              {s.dataImportInvalid ?? 'This file is not a valid backup.'}
            </p>
            <ul className="mt-2 list-disc pl-5">
              {validation.errors.map((e: string) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {result && (
          <div className="text-foreground/80 space-y-1 text-sm">
            <p className="font-medium">
              {result.success
                ? (s.dataImportComplete ?? 'Import complete.')
                : (s.dataImportFailed ?? 'Import failed.')}
            </p>
            {(['sessions', 'tasks', 'messages', 'files', 'settings'] as const)
              .map((k) => ({ k, c: result[k] }))
              .map(({ k, c }) => (
                <p key={k}>
                  {k}: {c.inserted} inserted, {c.updated} updated, {c.skipped}{' '}
                  skipped, {c.failed} failed
                </p>
              ))}
            {result.error && <p className="text-red-600">{result.error}</p>}
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium',
              'bg-secondary text-secondary-foreground hover:bg-secondary/80',
            )}
          >
            {result ? (s.close ?? 'Close') : (s.cancel ?? 'Cancel')}
          </button>
          {!result && (
            <button
              type="button"
              disabled={!validation.ok || busy}
              onClick={() => validation.data && onConfirm(validation.data)}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {busy
                ? (s.dataImportApplying ?? 'Importing…')
                : (s.dataImportConfirm ?? 'Import')}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
