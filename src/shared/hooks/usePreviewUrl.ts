import { useEffect, useState } from 'react';

import {
  getFileSize,
  getStreamUrl,
  resolveMediaPath,
} from '@/components/artifacts/media-loader';

interface PreviewUrlSource {
  path?: string;
  content?: string;
}

interface PreviewUrlOptions {
  maxSize?: number;
  revision?: number;
}

interface PreviewUrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
  fileTooLarge: number | null;
}

function isRemoteUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value);
}

function normalizeRemoteUrl(value: string): string {
  return value.startsWith('//') ? `https:${value}` : value;
}

export function usePreviewUrl(
  source: PreviewUrlSource,
  options: PreviewUrlOptions = {},
): PreviewUrlState {
  const { content, path } = source;
  const { maxSize, revision } = options;
  const [state, setState] = useState<PreviewUrlState>({
    url: null,
    loading: true,
    error: null,
    fileTooLarge: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({
      url: null,
      loading: true,
      error: null,
      fileTooLarge: null,
    });

    async function load() {
      if (content && (content.startsWith('data:') || isRemoteUrl(content))) {
        setState({
          url: normalizeRemoteUrl(content),
          loading: false,
          error: null,
          fileTooLarge: null,
        });
        return;
      }

      if (!path) {
        setState({
          url: null,
          loading: false,
          error: 'No preview file path available',
          fileTooLarge: null,
        });
        return;
      }

      try {
        if (isRemoteUrl(path)) {
          setState({
            url: normalizeRemoteUrl(path),
            loading: false,
            error: null,
            fileTooLarge: null,
          });
          return;
        }

        const resolvedPath = await resolveMediaPath(path, controller.signal);
        if (controller.signal.aborted) return;

        if (maxSize !== undefined) {
          const size = await getFileSize(resolvedPath, controller.signal);
          if (controller.signal.aborted) return;
          if (size !== null && size > maxSize) {
            setState({
              url: null,
              loading: false,
              error: null,
              fileTooLarge: size,
            });
            return;
          }
        }

        setState({
          url: getStreamUrl(resolvedPath, revision),
          loading: false,
          error: null,
          fileTooLarge: null,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          url: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          fileTooLarge: null,
        });
      }
    }

    void load();
    return () => controller.abort();
  }, [content, maxSize, path, revision]);

  return state;
}
