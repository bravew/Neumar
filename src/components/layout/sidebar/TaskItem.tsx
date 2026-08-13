import { memo, useCallback, useEffect, useRef, useState } from 'react';

import {
  Folder,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';

import { getTaskIcon } from './utils';

interface TaskItemProps {
  task: Task;
  isActive: boolean;
  isLoading: boolean;
  isRunning: boolean;
  variant: 'sidebar' | 'popup';
  t: ReturnType<typeof useLanguage>['t'];
  onSelect: (taskId: string) => void;
  onDelete: (taskId: string, e: React.MouseEvent) => void;
  onToggleFavorite: (task: Task, e: React.MouseEvent) => void;
  onViewFolder: (taskId: string, e: React.MouseEvent) => void;
  onRename: (taskId: string, newTitle: string) => Promise<void>;
  onRegenerate: (taskId: string) => Promise<void>;
  onDropdownOpenChange?: (open: boolean) => void;
}

export const TaskItem = memo(function TaskItem({
  task,
  isActive,
  isLoading,
  isRunning,
  variant,
  t,
  onSelect,
  onDelete,
  onToggleFavorite,
  onViewFolder,
  onRename,
  onRegenerate,
  onDropdownOpenChange,
}: TaskItemProps) {
  const taskTitle = task.title || task.prompt;
  const TaskIcon = getTaskIcon(taskTitle);
  const isSidebar = variant === 'sidebar';

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renameOpen) {
      setRenameValue(taskTitle);
      // Focus input after dialog animation
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [renameOpen, taskTitle]);

  const handleRenameSubmit = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== taskTitle) {
      await onRename(task.id, trimmed);
    }
    setRenameOpen(false);
  }, [renameValue, taskTitle, task.id, onRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleRenameSubmit();
      } else if (e.key === 'Escape') {
        setRenameOpen(false);
      }
    },
    [handleRenameSubmit],
  );

  const handleRegenerate = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsRegenerating(true);
      try {
        await onRegenerate(task.id);
      } finally {
        setIsRegenerating(false);
      }
    },
    [task.id, onRegenerate],
  );

  return (
    <>
      <div
        className={cn(
          'group relative flex w-full cursor-pointer items-center transition-all duration-200',
          isSidebar
            ? 'gap-2.5 rounded-lg px-2 py-2'
            : 'gap-3 rounded-lg px-3 py-2.5 text-left',
          isActive || isLoading
            ? isSidebar
              ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
              : 'bg-accent text-accent-foreground'
            : isSidebar
              ? 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              : 'text-foreground/80 hover:bg-accent/50',
        )}
        onClick={() => onSelect(task.id)}
      >
        <div className="relative shrink-0">
          <TaskIcon
            className={cn(
              'size-4',
              !isSidebar && 'text-muted-foreground size-5',
            )}
          />
          {isRunning && !isLoading && (
            <span className="absolute -top-0.5 -right-0.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-green-500" />
            </span>
          )}
        </div>
        <span className="min-w-0 flex-1 truncate text-sm">{taskTitle}</span>
        {isLoading && (
          <div className="flex shrink-0 items-center justify-center">
            {isSidebar ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <AILoadingIndicator size="sm" />
            )}
          </div>
        )}
        {isRunning ? (
          <div
            className={cn(
              'flex shrink-0 items-center justify-center',
              isSidebar ? 'size-4' : 'size-6',
            )}
          >
            {isSidebar ? (
              <Loader2 className="size-4 animate-spin text-green-500" />
            ) : (
              <AILoadingIndicator size="sm" />
            )}
          </div>
        ) : null}
        <DropdownMenu onOpenChange={onDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="flex size-6 shrink-0 items-center justify-center rounded transition-all"
            >
              {task.favorite ? (
                <>
                  <Star className="size-4 fill-amber-400 text-amber-400 group-hover:hidden" />
                  <MoreHorizontal
                    className={cn(
                      'hidden size-4 group-hover:block',
                      isSidebar
                        ? 'text-sidebar-foreground/40 hover:text-sidebar-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  />
                </>
              ) : (
                <MoreHorizontal
                  className={cn(
                    'size-4 opacity-0 group-hover:opacity-100',
                    isSidebar
                      ? 'text-sidebar-foreground/40 hover:text-sidebar-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className={cn('min-w-[160px]', !isSidebar && 'z-[100]')}
          >
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setRenameOpen(true);
              }}
            >
              <Pencil className="size-4" />
              <span>{t.common.renameTitle}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={isRegenerating}
              onClick={handleRegenerate}
            >
              <RefreshCw
                className={cn('size-4', isRegenerating && 'animate-spin')}
              />
              <span>
                {isRegenerating
                  ? t.common.regeneratingTitle
                  : t.common.regenerateTitle}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={(e) => onToggleFavorite(task, e)}
            >
              <Star
                className={cn(
                  'size-4',
                  task.favorite && 'fill-amber-400 text-amber-400',
                )}
              />
              <span>
                {task.favorite ? t.common.unfavorite : t.common.favorite}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={(e) => onViewFolder(task.id, e)}
            >
              <Folder className="size-4" />
              <span>{t.common.viewFolder}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-red-500 focus:text-red-500"
              onClick={(e) => onDelete(task.id, e)}
            >
              <Trash2 className="size-4" />
              <span>{t.common.delete}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent
          className="sm:max-w-md"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{t.common.renameTitle}</DialogTitle>
          </DialogHeader>
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            placeholder={t.common.renameTitlePlaceholder}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring mt-1 flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          />
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => void handleRenameSubmit()}
              disabled={!renameValue.trim()}
            >
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
