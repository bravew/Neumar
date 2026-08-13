import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { Check, ChevronRight, Folder, Pencil, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import type { DesignFileEntry } from '@/shared/types/design-mode';

export function FileWorkspaceRow({
  file,
  active,
  selected,
  onOpen,
  onToggle,
  onRename,
  folderLabel,
  renameLabel,
  renameCommitLabel,
  renameCancelLabel,
}: {
  file: DesignFileEntry;
  active: boolean;
  selected: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  onToggle: (event: MouseEvent<HTMLInputElement>) => void;
  onRename: (from: string, to: string) => void;
  folderLabel: string;
  renameLabel: string;
  renameCommitLabel: string;
  renameCancelLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.path);

  useEffect(() => {
    setDraft(file.path);
  }, [file.path]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const cancel = () => {
    setDraft(file.path);
    setEditing(false);
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== file.path) onRename(file.path, next);
  };

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  if (file.isDir) {
    return (
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
        aria-label={folderLabel.replace('{name}', file.name)}
        onClick={onOpen}
      >
        <Folder className="text-muted-foreground size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <ChevronRight className="text-muted-foreground size-3 shrink-0" />
      </button>
    );
  }
  return (
    <div
      className={cn(
        'hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
        active && 'bg-accent text-accent-foreground',
        selected && 'ring-primary/40 ring-1',
      )}
    >
      <input
        type="checkbox"
        aria-label={`Select ${file.path}`}
        checked={selected}
        onClick={onToggle}
        onChange={() => {}}
        className="size-3 shrink-0"
      />
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            aria-label={renameLabel}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onRenameKeyDown}
            onBlur={commit}
            className="border-input bg-background min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none"
          />
          <button
            type="button"
            className="hover:bg-accent rounded p-1"
            aria-label={renameCommitLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={commit}
          >
            <Check className="size-3" />
          </button>
          <button
            type="button"
            className="hover:bg-accent rounded p-1"
            aria-label={renameCancelLabel}
            onMouseDown={(event) => event.preventDefault()}
            onClick={cancel}
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="min-w-0 flex-1 truncate py-1 text-left"
            onClick={onOpen}
          >
            {file.path}
          </button>
          <button
            type="button"
            className="hover:bg-accent rounded p-1"
            aria-label={renameLabel}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}
