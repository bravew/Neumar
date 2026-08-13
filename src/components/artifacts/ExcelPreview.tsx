import { useEffect, useState } from 'react';

import JSZip from 'jszip';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import readXlsxFile from 'read-excel-file/browser';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { cn } from '@/shared/lib/utils';

import { FileTooLarge } from './FileTooLarge';
import { loadLocalArtifactBuffer } from './media-loader';
import type { ExcelSheet, PreviewComponentProps } from './types';
import { isRemoteUrl, MAX_PREVIEW_SIZE, openFileExternal } from './utils';

const EXCEL_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function createExcelBlob(data: ArrayBuffer | Uint8Array): Blob {
  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type: EXCEL_MIME_TYPE });
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy.buffer], { type: EXCEL_MIME_TYPE });
}

function formatExcelCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toLocaleString();
  return String(cell);
}

async function parseExcelSheets(
  data: ArrayBuffer | Uint8Array,
): Promise<ExcelSheet[]> {
  const blob = createExcelBlob(data);
  // read-excel-file v9 default export returns Sheet[] (one entry per sheet),
  // each shaped { sheet: string; data: SheetData }.
  const sheets = await readXlsxFile(blob);
  return sheets.map(({ sheet, data }) => ({
    name: sheet,
    data: data.map((row) => row.map(formatExcelCell)),
  }));
}

export function ExcelPreview({ artifact }: PreviewComponentProps) {
  const [sheets, setSheets] = useState<ExcelSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);

  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadExcel() {
      if (!artifact.path) {
        setError('No Excel file path available');
        setLoading(false);
        return;
      }

      try {
        let arrayBuffer: ArrayBuffer;

        if (isRemoteUrl(artifact.path)) {
          const url = artifact.path.startsWith('//')
            ? `https:${artifact.path}`
            : artifact.path;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch Excel: ${response.status} ${response.statusText}`,
            );
          }
          arrayBuffer = await response.arrayBuffer();
        } else {
          const result = await loadLocalArtifactBuffer(
            artifact.path,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            MAX_PREVIEW_SIZE,
          );
          if ('tooLarge' in result) {
            if (!cancelled) {
              setFileTooLarge(result.tooLarge);
              setLoading(false);
            }
            return;
          }
          arrayBuffer = result.arrayBuffer;
        }
        if (cancelled) return;

        console.warn('[Excel Preview] Loaded', arrayBuffer.byteLength, 'bytes');

        // Try to parse the Excel file

        let parsedSheets: ExcelSheet[] = [];
        try {
          parsedSheets = await parseExcelSheets(arrayBuffer);
        } catch (parseError) {
          console.error(
            '[Excel Preview] Direct parsing failed, trying JSZip decompress:',
            parseError,
          );

          // Second attempt: Use JSZip to decompress first
          try {
            const zip = await JSZip.loadAsync(arrayBuffer);
            const newZip = new JSZip();

            // Re-compress all files with standard DEFLATE compression
            const files = Object.keys(zip.files);
            for (const fileName of files) {
              const file = zip.files[fileName];
              if (!file.dir) {
                const content = await file.async('uint8array');
                newZip.file(fileName, content, { compression: 'DEFLATE' });
              }
            }

            // Generate new zip with standard compression
            const recompressedData = await newZip.generateAsync({
              type: 'uint8array',
              compression: 'DEFLATE',
              compressionOptions: { level: 6 },
            });

            parsedSheets = await parseExcelSheets(recompressedData);
          } catch (jsZipError) {
            console.error(
              '[Excel Preview] JSZip fallback also failed:',
              jsZipError,
            );
            throw parseError;
          }
        }

        if (parsedSheets.length === 0) {
          throw new Error('Failed to parse Excel file');
        }

        console.warn('[Excel Preview] Parsed', parsedSheets.length, 'sheets');
        setSheets(parsedSheets);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('[Excel Preview] Failed to load Excel:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadExcel();
    return () => {
      cancelled = true;
    };
  }, [artifact.path]);

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <AILoadingIndicator size="md" />
        <p className="text-muted-foreground mt-4 text-sm">Loading Excel...</p>
      </div>
    );
  }

  if (fileTooLarge !== null) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={fileTooLarge}
        icon={FileSpreadsheet}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  if (error || sheets.length === 0) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
            <FileSpreadsheet className="size-10 text-green-600" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground mb-4 text-sm break-all whitespace-pre-wrap">
            {error || 'No data available'}
          </p>
          <button
            onClick={handleOpenExternal}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <ExternalLink className="size-4" />
            Open in Excel
          </button>
        </div>
      </div>
    );
  }

  const currentSheet = sheets[activeSheet];

  return (
    <div className="flex h-full flex-col">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="border-border bg-muted/30 flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(index)}
              className={cn(
                'shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                index === activeSheet
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Table content */}
      <div className="bg-background flex-1 overflow-auto">
        {currentSheet && currentSheet.data.length > 0 ? (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted sticky top-0 z-10">
              {currentSheet.data.length > 0 && (
                <tr>
                  {/* Row number header */}
                  <th className="border-border bg-muted text-muted-foreground sticky left-0 z-20 w-10 border px-2 py-2 text-center text-xs font-medium">
                    #
                  </th>
                  {currentSheet.data[0].map((cell, i) => (
                    <th
                      key={i}
                      className="border-border text-foreground min-w-[100px] border px-3 py-2 text-left font-medium"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {currentSheet.data.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-muted/50">
                  {/* Row number */}
                  <td className="border-border bg-muted/50 text-muted-foreground sticky left-0 border px-2 py-2 text-center text-xs">
                    {rowIndex + 2}
                  </td>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-border text-foreground border px-3 py-2"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Empty sheet
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="border-border bg-muted/30 text-muted-foreground shrink-0 border-t px-3 py-1.5 text-xs">
        {currentSheet && (
          <span>
            {currentSheet.data.length} rows ×{' '}
            {currentSheet.data[0]?.length || 0} columns
          </span>
        )}
      </div>
    </div>
  );
}
