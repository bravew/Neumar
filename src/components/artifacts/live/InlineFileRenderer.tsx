/**
 * Loads a workspace file's content via the API and renders it through the
 * matching live-artifact component. Used by TaskV2MessageBubble to render
 * agent-mentioned artifact files (e.g. ".../output/foo.md" referenced in
 * the assistant text) inline, without requiring the file content to be in
 * the message itself.
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { CodeArtifact } from './CodeArtifact';
import { HtmlSandbox } from './HtmlSandbox';
import { MarkdownArtifact } from './MarkdownArtifact';
import { MermaidArtifact } from './MermaidArtifact';
import { SvgSandbox } from './SvgSandbox';

export type InlineFileKind = 'svg' | 'html' | 'markdown' | 'mermaid' | 'code';

interface InlineFileRendererProps {
  /** Absolute path served by /files/read. */
  path: string;
  kind: InlineFileKind;
  /** Display title (basename if omitted). */
  title?: string;
  language?: string;
  className?: string;
}

// Cap is in UTF-16 char units (String.length), not bytes.
const MAX_INLINE_CHARS = 256 * 1024;

export function InlineFileRenderer({
  path,
  kind,
  title,
  language,
  className,
}: InlineFileRendererProps) {
  const { t } = useLanguage();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setContent(null);
    setError(null);
    fetch(`${API_BASE_URL}/files/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: ac.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ content?: string; error?: string }>;
      })
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        const text = data.content ?? '';
        if (text.length > MAX_INLINE_CHARS) {
          setError(
            t.artifacts.filePreviewTooLarge.replace(
              '{chars}',
              String(text.length),
            ),
          );
          return;
        }
        setContent(text);
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => ac.abort();
  }, [path, t.artifacts.filePreviewTooLarge]);

  const display = title ?? path.split('/').pop() ?? path;

  if (error) {
    return (
      <div
        className={cn(
          'border-border/50 bg-muted/30 my-3 rounded-lg border px-3 py-2 text-xs',
          className,
        )}
      >
        <div className="text-muted-foreground">{display}</div>
        <div className="text-destructive mt-1">{error}</div>
      </div>
    );
  }

  if (content === null) {
    return (
      <div
        className={cn(
          'border-border/50 bg-muted/30 my-3 rounded-lg border px-3 py-2 text-xs',
          className,
        )}
      >
        <div className="text-muted-foreground">
          {t.artifacts.loadingFile.replace('{name}', display)}
        </div>
      </div>
    );
  }

  const wrap = (child: ReactNode) => (
    <div
      className={cn(
        'border-border/50 my-3 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <div className="text-muted-foreground bg-muted/30 border-border/50 border-b px-3 py-1.5 text-xs">
        {display}
      </div>
      {child}
    </div>
  );

  switch (kind) {
    case 'svg':
      return wrap(<SvgSandbox svg={content} identity={path} title={display} />);
    case 'html':
      return wrap(
        <HtmlSandbox html={content} identity={path} title={display} />,
      );
    case 'mermaid':
      return wrap(<MermaidArtifact source={content} />);
    case 'markdown':
      return wrap(<MarkdownArtifact source={content} />);
    case 'code':
      return wrap(<CodeArtifact source={content} language={language} />);
    default:
      return null;
  }
}
