import { useEffect, useRef, useState, type DragEvent } from 'react';

import { FileText } from 'lucide-react';

import { cn } from '@/shared/lib/utils';

export function FileTabStrip({
  homeLabel,
  tabs,
  activePath,
  homeActive = false,
  onHome,
  onSelect,
  onReorder,
}: {
  homeLabel: string;
  tabs: string[];
  activePath: string | null;
  /** Highlight the home (Design Files) tab even while a file stays loaded
   *  underneath — the creations gallery is an explicit overlay. */
  homeActive?: boolean;
  onHome: () => void;
  onSelect: (path: string) => void;
  onReorder: (tabs: string[]) => void;
}) {
  const [dragPath, setDragPath] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!activePath) return;
    tabRefs.current.get(activePath)?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activePath]);

  const reorder = (targetPath: string, event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const sourcePath = event.dataTransfer.getData('text/plain') || dragPath;
    if (!sourcePath || sourcePath === targetPath) return;
    const from = tabs.indexOf(sourcePath);
    const to = tabs.indexOf(targetPath);
    if (from < 0 || to < 0) return;
    const next = [...tabs];
    next.splice(from, 1);
    next.splice(to, 0, sourcePath);
    onReorder(next);
    setDragPath(null);
  };

  return (
    <div className="border-border flex min-h-10 shrink-0 border-b">
      <button
        type="button"
        className={cn(
          'border-border bg-background shrink-0 border-r px-3 text-left text-xs font-medium',
          (homeActive || !activePath) && 'bg-accent text-accent-foreground',
        )}
        onClick={onHome}
      >
        {homeLabel}
      </button>
      <div className="flex min-w-0 flex-1 scrollbar-thin overflow-x-auto">
        {tabs.map((path) => (
          <button
            key={path}
            ref={(node) => {
              if (node) tabRefs.current.set(path, node);
              else tabRefs.current.delete(path);
            }}
            type="button"
            draggable
            aria-label={`Open ${path}`}
            className={cn(
              'border-border hover:bg-accent flex max-w-56 min-w-32 shrink-0 items-center gap-2 border-r px-3 text-left text-xs',
              !homeActive &&
                activePath === path &&
                'bg-accent text-accent-foreground',
              dragPath === path && 'opacity-60',
            )}
            onClick={() => onSelect(path)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', path);
              setDragPath(path);
            }}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => reorder(path, event)}
            onDragEnd={() => setDragPath(null)}
          >
            <FileText className="text-muted-foreground size-3 shrink-0" />
            <span className="min-w-0 truncate">{path}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
