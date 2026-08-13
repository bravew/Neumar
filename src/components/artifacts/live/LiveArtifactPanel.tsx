import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { X } from 'lucide-react';

import { DirectionPickerArtifact } from '@/components/artifacts/discovery/DirectionPicker';
import { QuestionFormArtifact } from '@/components/artifacts/discovery/QuestionForm';
import { TodoCardArtifact } from '@/components/artifacts/discovery/TodoCard';
import { MediaProgressCard } from '@/components/artifacts/media/MediaProgressCard';
import { useLiveArtifacts } from '@/shared/hooks/useLiveArtifacts';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { ArtifactKind, ArtifactSnapshot } from '@/shared/types/artifact';

import { CodeArtifact } from './CodeArtifact';
import { HtmlSandbox } from './HtmlSandbox';
import { MarkdownArtifact } from './MarkdownArtifact';
import { MermaidArtifact } from './MermaidArtifact';
import { SvgSandbox } from './SvgSandbox';
import {
  TODO_ARTIFACT_DISMISSAL_STORAGE_KEY,
  addTodoArtifactDismissalKey,
  getTodoArtifactDismissalKey,
  readTodoArtifactDismissalKeys,
  writeTodoArtifactDismissalKeys,
} from './todo-dismissal';

interface LiveArtifactPanelProps {
  taskId: string;
  isRunning: boolean;
  onClose?: () => void;
  className?: string;
}

const RENDERERS: Record<ArtifactKind, FC<{ snapshot: ArtifactSnapshot }>> = {
  html: ({ snapshot }) => (
    <HtmlSandbox
      html={snapshot.content}
      identity={snapshot.id}
      title={snapshot.title}
    />
  ),
  svg: ({ snapshot }) => (
    <SvgSandbox
      svg={snapshot.content}
      identity={snapshot.id}
      title={snapshot.title}
    />
  ),
  mermaid: ({ snapshot }) => <MermaidArtifact source={snapshot.content} />,
  markdown: ({ snapshot }) => <MarkdownArtifact source={snapshot.content} />,
  code: ({ snapshot }) => (
    <CodeArtifact source={snapshot.content} language={snapshot.language} />
  ),
  'question-form': ({ snapshot }) => {
    const payload = parseArtifactJson<{
      title?: string;
      fields?: Parameters<typeof QuestionFormArtifact>[0]['fields'];
    }>(snapshot.content);
    if (!payload || !Array.isArray(payload.fields)) {
      return <MarkdownArtifact source={snapshot.content} />;
    }
    return (
      <QuestionFormArtifact title={payload.title} fields={payload.fields} />
    );
  },
  'direction-picker': ({ snapshot }) => {
    const payload = parseArtifactJson<{
      directions?: Parameters<typeof DirectionPickerArtifact>[0]['directions'];
    }>(snapshot.content);
    if (!payload || !Array.isArray(payload.directions)) {
      return <MarkdownArtifact source={snapshot.content} />;
    }
    return <DirectionPickerArtifact directions={payload.directions} />;
  },
  'todo-list': ({ snapshot }) => {
    const payload = parseArtifactJson<{
      items?: Parameters<typeof TodoCardArtifact>[0]['items'];
    }>(snapshot.content);
    if (!payload || !Array.isArray(payload.items)) {
      return <MarkdownArtifact source={snapshot.content} />;
    }
    return <TodoCardArtifact items={payload.items} />;
  },
  'media-progress': ({ snapshot }) => {
    const payload = parseArtifactJson<{
      task?: Parameters<typeof MediaProgressCard>[0]['task'];
    }>(snapshot.content);
    if (!payload?.task) {
      return <MarkdownArtifact source={snapshot.content} />;
    }
    return <MediaProgressCard task={payload.task} />;
  },
  // React + chart kinds reserved for follow-up PRs (in-iframe esbuild-wasm
  // compile and the typed recharts wrapper, respectively).
  react: ({ snapshot }) => <ComingSoonRow kind={snapshot.kind} />,
  chart: ({ snapshot }) => <ComingSoonRow kind={snapshot.kind} />,
};

export function LiveArtifactPanel({
  taskId,
  isRunning,
  onClose,
  className,
}: LiveArtifactPanelProps) {
  const { t } = useLanguage();
  const artifacts = useLiveArtifacts(taskId, isRunning);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dismissedTodoKeys, setDismissedTodoKeys] = useState(() =>
    readTodoArtifactDismissalKeys(),
  );

  const list = useMemo(
    () =>
      Array.from(artifacts.values())
        .filter((artifact) => {
          const key = getTodoArtifactDismissalKey(artifact);
          return !key || !dismissedTodoKeys.has(key);
        })
        .sort((a, b) => a.createdAt - b.createdAt),
    [artifacts, dismissedTodoKeys],
  );

  const visibleArtifacts = useMemo(
    () => new Map(list.map((artifact) => [artifact.id, artifact])),
    [list],
  );

  useEffect(() => {
    if (!list.length) {
      setActiveId(null);
      return;
    }
    const newest = list[list.length - 1]!.id;
    setActiveId((prev) => (prev && visibleArtifacts.has(prev) ? prev : newest));
  }, [list, visibleArtifacts]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TODO_ARTIFACT_DISMISSAL_STORAGE_KEY) return;
      setDismissedTodoKeys(readTodoArtifactDismissalKeys());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const active = activeId ? visibleArtifacts.get(activeId) : undefined;

  const dismissActiveTodo = useCallback(() => {
    if (!active) return;
    const key = getTodoArtifactDismissalKey(active);
    if (!key) return;

    setDismissedTodoKeys((current) => {
      const next = addTodoArtifactDismissalKey(current, key);
      writeTodoArtifactDismissalKeys(next);
      return next;
    });
  }, [active]);

  if (!list.length) return null;

  if (!active) return null;
  const Renderer = RENDERERS[active.kind];

  return (
    <div
      className={cn(
        'bg-background flex h-full min-h-0 flex-col border-l',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-foreground truncate text-sm font-semibold">
          {t.artifacts.livePanelTitle}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded p-1"
            aria-label={t.common.close}
          >
            <X className="size-4" />
          </button>
        )}
      </header>

      {list.length > 1 && (
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveId(a.id)}
              className={cn(
                'rounded px-2 py-1 text-xs whitespace-nowrap transition-colors',
                a.id === activeId
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {a.title || a.kind}
            </button>
          ))}
        </nav>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {active.kind === 'todo-list' ? (
          <TodoArtifactRenderer
            dismissLabel={t.common.dismiss}
            snapshot={active}
            onDismiss={dismissActiveTodo}
          />
        ) : (
          <Renderer snapshot={active} />
        )}
      </div>
    </div>
  );
}

function TodoArtifactRenderer({
  dismissLabel,
  snapshot,
  onDismiss,
}: {
  dismissLabel: string;
  snapshot: ArtifactSnapshot;
  onDismiss: () => void;
}) {
  const payload = parseArtifactJson<{
    items?: Parameters<typeof TodoCardArtifact>[0]['items'];
  }>(snapshot.content);
  if (!payload || !Array.isArray(payload.items)) {
    return <MarkdownArtifact source={snapshot.content} />;
  }
  return (
    <TodoCardArtifact
      dismissLabel={dismissLabel}
      items={payload.items}
      onDismiss={onDismiss}
    />
  );
}

function ComingSoonRow({ kind }: { kind: string }) {
  const { t } = useLanguage();
  return (
    <div className="text-muted-foreground p-4 text-sm">
      {t.artifacts.comingSoon.replace('{kind}', kind)}
    </div>
  );
}

function parseArtifactJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
