/**
 * Encapsulates the JSON-backup import flow used by DataSettings.
 *
 * Owns dialog open state, the parsed payload, the import result, and the
 * callbacks for confirming/cancelling. Splits behavior out of the
 * DataSettings component so the page stays under the size budget.
 */

import { useCallback, useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { BackupV1, ImportResult } from '@/shared/db/backup-schema';
import { saveSettings, type Settings } from '@/shared/db/settings';

export interface UseDataImportApi {
  dialogOpen: boolean;
  payload: unknown | null;
  result: ImportResult | null;
  busy: boolean;
  error: string;
  pickFile: () => Promise<void>;
  confirm: (data: BackupV1) => Promise<void>;
  setDialogOpen: (open: boolean) => void;
}

export function useDataImport(): UseDataImportApi {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [payload, setPayload] = useState<unknown | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickFile = useCallback(async () => {
    setError('');
    setResult(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });
      if (!filePath) return;
      const content = await readTextFile(filePath as string);
      setPayload(JSON.parse(content) as unknown);
      setDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  }, []);

  const confirm = useCallback(async (data: BackupV1) => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/db/import-backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = (await res.json()) as ImportResult;
      setResult(body);
      if (data.settings) {
        try {
          saveSettings(data.settings as unknown as Settings);
        } catch (err) {
          if (import.meta.env.DEV)
            console.warn('[useDataImport] saveSettings failed:', err);
        }
      }
      if (!body.success) setError(body.error ?? 'Import failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSetDialogOpen = useCallback((next: boolean) => {
    setDialogOpen(next);
    if (!next) {
      setPayload(null);
      setResult(null);
    }
  }, []);

  return {
    dialogOpen,
    payload,
    result,
    busy,
    error,
    pickFile,
    confirm,
    setDialogOpen: handleSetDialogOpen,
  };
}
