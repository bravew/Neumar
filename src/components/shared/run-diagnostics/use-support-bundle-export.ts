import { useState } from 'react';

import { API_BASE_URL } from '@/config';
import type { ExecutionDiagnosticsV1 } from '@/shared/types/execution-diagnostics';

export function useSupportBundleExport(
  runId: string,
  diagnostics: ExecutionDiagnosticsV1 | null,
) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  const exportSupportBundle = async () => {
    if (!diagnostics || exporting) return;
    setExporting(true);
    setExportError(false);
    try {
      const response = await fetch(
        `${API_BASE_URL}/runs/${encodeURIComponent(runId)}/support-bundle`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: diagnostics.mode,
            ownerKey: diagnostics.ownerKey,
          }),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      downloadBundle(
        await response.blob(),
        response.headers.get('content-disposition'),
      );
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  return { exporting, exportError, exportSupportBundle };
}

function downloadBundle(blob: Blob, disposition: string | null) {
  const filename =
    disposition?.match(/filename="([a-zA-Z0-9._-]+)"/)?.[1] ??
    'neuma-support.zip';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
