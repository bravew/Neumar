import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import {
  lintDesignFile,
  readDesignFile,
  writeDesignFile,
} from '@/shared/hooks/useDesignMode';
import type { DesignLintFinding } from '@/shared/types/design-mode';

import {
  classifyFileSystemReadError,
  type FileSystemReadError,
} from './file-system-errors';
import { formatJsonFileTextForDisplay } from './file-viewer-utils';

export function useFileViewerContent({
  projectId,
  path,
  isText,
  reloadKey,
}: {
  projectId: string;
  path: string | null;
  isText: boolean;
  reloadKey: number;
}) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [lintFindings, setLintFindings] = useState<DesignLintFinding[]>([]);
  const [linting, setLinting] = useState(false);
  const [sourceCopied, setSourceCopied] = useState(false);
  const [readError, setReadError] = useState<FileSystemReadError | null>(null);
  const [readReloadKey, setReadReloadKey] = useState(0);

  useEffect(() => {
    if (!path || !isText) {
      setContent('');
      setLintFindings([]);
      setReadError(null);
      return;
    }
    const ac = new AbortController();
    setReadError(null);
    readDesignFile(projectId, path, { signal: ac.signal })
      .then((file) => {
        setContent(formatJsonFileTextForDisplay(path, file.content));
        setLintFindings([]);
        setReadError(null);
      })
      .catch((error: unknown) => {
        if (!ac.signal.aborted) {
          setContent('');
          setLintFindings([]);
          setReadError(classifyFileSystemReadError(error));
        }
      });
    return () => ac.abort();
  }, [isText, path, projectId, readReloadKey, reloadKey]);

  useEffect(() => {
    if (!path || !isText || typeof EventSource === 'undefined') return;
    const events = new EventSource(
      `${API_BASE_URL}/design/projects/${projectId}/preview`,
    );
    const reload = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { path?: string };
        if (payload.path && payload.path !== path) return;
      } catch {
        return;
      }
      readDesignFile(projectId, path)
        .then((file) => {
          setContent(formatJsonFileTextForDisplay(path, file.content));
          setReadError(null);
        })
        .catch((error: unknown) => {
          setReadError(classifyFileSystemReadError(error));
        });
    };
    events.addEventListener('reload', reload);
    events.onerror = () => events.close();
    return () => {
      events.removeEventListener('reload', reload);
      events.close();
    };
  }, [isText, path, projectId]);

  const save = useCallback(async () => {
    if (!path || !isText) return;
    setSaving(true);
    try {
      const result = await writeDesignFile(projectId, path, content);
      setLintFindings(result.lint);
    } finally {
      setSaving(false);
    }
  }, [content, isText, path, projectId]);

  const runLint = useCallback(async () => {
    if (!path || !isText) return;
    setLinting(true);
    try {
      const result = await lintDesignFile(projectId, { path, content });
      setLintFindings(result.findings);
    } finally {
      setLinting(false);
    }
  }, [content, isText, path, projectId]);

  const copySource = useCallback(async () => {
    if (!isText) return;
    await navigator.clipboard?.writeText(content);
    setSourceCopied(true);
  }, [content, isText]);

  const resetViewState = useCallback(() => {
    setSourceCopied(false);
  }, []);

  const retryRead = useCallback(() => {
    setReadReloadKey((key) => key + 1);
  }, []);

  return {
    content,
    setContent,
    readError,
    saving,
    lintFindings,
    linting,
    sourceCopied,
    save,
    runLint,
    copySource,
    retryRead,
    resetViewState,
  };
}
