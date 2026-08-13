import { useCallback, useEffect, useRef, useState } from 'react';

import { FileText } from 'lucide-react';
import { Document, pdfjs } from 'react-pdf';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';

import { FileTooLarge } from './FileTooLarge';
import { getFileSize, getStreamUrl, resolveMediaPath } from './media-loader';
import { LazyPage } from './pdf/LazyPage';
import { PdfToolbar } from './pdf/PdfToolbar';
import type { PreviewComponentProps } from './types';
import { isRemoteUrl, MAX_PREVIEW_SIZE, openFileExternal } from './utils';

// Worker: Vite rewrites new URL(..., import.meta.url) to hashed asset path at build time
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  cMapPacked: true,
};

const DEFAULT_SCALE = 1.0;

export function PdfPreview({ artifact }: PreviewComponentProps) {
  const [pdfSource, setPdfSource] = useState<
    { data: Uint8Array } | string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const handleOpenExternal = useCallback(() => {
    if (artifact.path) openFileExternal(artifact.path);
  }, [artifact.path]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    pageRefs.current[page]?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, []);

  const setPageRef = useCallback((page: number, el: HTMLDivElement | null) => {
    pageRefs.current[page] = el;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      if (!artifact.path) {
        setError('No PDF file path available');
        setLoading(false);
        return;
      }

      try {
        if (isRemoteUrl(artifact.path)) {
          // Remote: pass URL directly — react-pdf fetches with range requests
          const url = artifact.path.startsWith('//')
            ? `https:${artifact.path}`
            : artifact.path;
          if (!cancelled) setPdfSource(url);
        } else {
          // Local: resolve the path (handles moved/renamed session folders),
          // then size-check and stream.
          const resolved = await resolveMediaPath(artifact.path);
          const size = await getFileSize(resolved);
          if (size === null) {
            throw new Error('File not found or cannot be accessed');
          }
          if (size > MAX_PREVIEW_SIZE) {
            if (!cancelled) setFileTooLarge(size);
            return;
          }
          if (!cancelled) setPdfSource(getStreamUrl(resolved));
        }
        if (!cancelled) setError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [artifact.path]);

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <AILoadingIndicator size="md" />
        <p className="text-muted-foreground mt-4 text-sm">Loading PDF...</p>
      </div>
    );
  }

  if (fileTooLarge !== null) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={fileTooLarge}
        icon={FileText}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  if (error || !pdfSource) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
            <FileText className="size-10 text-red-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground text-sm break-all whitespace-pre-wrap">
            {error ?? 'No PDF file path available'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted/20 flex h-full flex-col">
      <PdfToolbar
        currentPage={currentPage}
        numPages={numPages}
        scale={scale}
        onPageChange={handlePageChange}
        onScaleChange={setScale}
        onOpenExternal={artifact.path ? handleOpenExternal : undefined}
      />
      <div className="flex-1 overflow-auto px-4 py-2">
        <Document
          file={pdfSource}
          options={PDF_OPTIONS}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={(err) => {
            setError(err.message);
          }}
          loading={null}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <LazyPage
              key={i + 1}
              pageNumber={i + 1}
              scale={scale}
              onVisible={setCurrentPage}
              onScrollRef={setPageRef}
            />
          ))}
        </Document>
      </div>
    </div>
  );
}
