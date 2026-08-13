import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

export interface ImportedOverlayItem {
  id: string;
  name: string;
  kind: 'gif' | 'lottie';
  relativePath: string;
  source: {
    kind: 'local-upload';
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  };
  provenance: {
    kind: 'import';
    provider: 'local';
    createdAt: string;
  };
}

const IMPORTS_URL = `${API_BASE_URL}/video/overlay-imports`;

export const IMPORTED_OVERLAYS_CHANGED = 'neuma:imported-overlays';

export function importedOverlayAssetUrl(id: string): string {
  return `${IMPORTS_URL}/${encodeURIComponent(id)}/asset`;
}

export function useImportedOverlays() {
  const [imports, setImports] = useState<ImportedOverlayItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetch(IMPORTS_URL, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { imports?: ImportedOverlayItem[] } | null) => {
          if (payload?.imports) setImports(payload.imports);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(IMPORTED_OVERLAYS_CHANGED, load);
    return () => {
      controller.abort();
      window.removeEventListener(IMPORTED_OVERLAYS_CHANGED, load);
    };
  }, []);

  const importLocal = useCallback(async (file: File): Promise<boolean> => {
    try {
      const response = await fetch(IMPORTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name.replace(/\.(gif|json|lottie)$/i, '') || file.name,
          fileName: file.name,
          mimeType: file.type || mimeTypeForFile(file.name),
          dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
        }),
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as {
        import?: ImportedOverlayItem;
      };
      if (payload.import) {
        const saved = payload.import;
        setImports((prev) => [...prev, saved]);
      }
      window.dispatchEvent(new Event(IMPORTED_OVERLAYS_CHANGED));
      return true;
    } catch {
      return false;
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`${IMPORTS_URL}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setImports((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      // keep the list as-is; a refresh re-syncs
    }
  }, []);

  return { importLocal, imports, remove };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(''));
}

function mimeTypeForFile(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.lottie')) return 'application/lottie+json';
  return 'application/json';
}
