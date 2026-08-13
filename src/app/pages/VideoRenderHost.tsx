import { useEffect } from 'react';

import {
  exportWebCodecsVideo,
  type WebCodecsExportRequest,
  type WebCodecsExportResult,
} from '@/components/video/preview/webcodecs/exportVideo';
import { classifyExportError } from '@/shared/utils/export-error';

interface WebCodecsExportError {
  code: string;
  error: string;
  ok: false;
}

type WebCodecsRenderHostResponse = WebCodecsExportResult | WebCodecsExportError;

declare global {
  interface Window {
    neumaVideoExport?: (
      request: WebCodecsExportRequest,
    ) => Promise<WebCodecsRenderHostResponse>;
    neumaVideoExportProgress?: number;
    neumaVideoRenderReady?: boolean;
  }
}

export function VideoRenderHostPage() {
  useEffect(() => {
    window.neumaVideoExportProgress = 0;
    window.neumaVideoExport = async (request) => {
      try {
        return await exportWebCodecsVideo(request);
      } catch (error) {
        const classified = classifyExportError(error);
        return {
          code: classified.code,
          error: classified.message,
          ok: false,
        };
      }
    };
    window.neumaVideoRenderReady = true;

    return () => {
      delete window.neumaVideoExport;
      delete window.neumaVideoExportProgress;
      delete window.neumaVideoRenderReady;
    };
  }, []);

  return <main aria-hidden="true" className="hidden" />;
}
