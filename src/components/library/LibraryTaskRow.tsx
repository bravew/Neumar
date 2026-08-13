/**
 * LibraryTaskRow — Single task row with always-visible checkbox and rich metadata.
 *
 * Layout:
 * [☐] [StatusIcon] Title ★     📂  $Cost  Duration
 *      relative time · absolute date                [♡]
 */

import { memo } from 'react';

import { Calendar, Check, Clock, FolderOpen, Heart, Star } from 'lucide-react';
import { motion } from 'motion/react';

import { DURATION, EASE, STAGGER } from '@/config/animation';
import type { Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';

import {
  formatAbsoluteDate,
  formatCost,
  formatDuration,
  formatRelativeTime,
  getStatusConfig,
} from './library-utils';

interface LibraryTaskRowProps {
  task: Task;
  index: number;
  isSelected: boolean;
  isRunningBg: boolean;
  profileName?: string;
  t: ReturnType<typeof useLanguage>['t'];
  onToggleSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onOpenFolder: (taskId: string) => void;
}

export const LibraryTaskRow = memo(function LibraryTaskRow({
  task,
  index,
  isSelected,
  isRunningBg,
  profileName,
  t,
  onToggleSelect,
  onNavigate,
  onToggleFavorite,
  onOpenFolder,
}: LibraryTaskRowProps) {
  const statusConfig = getStatusConfig(task.status);
  const StatusIcon = statusConfig.icon;
  const costStr = formatCost(task.cost);
  const durationStr = formatDuration(task.duration);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: DURATION.normal,
        ease: EASE.out,
        delay: Math.min(index * STAGGER.fast, 0.5),
      }}
      className={cn(
        'border-border group flex items-start gap-3 border-b px-1 py-3 transition-colors',
        isSelected && 'bg-accent/50',
        !isSelected && 'hover:bg-accent/30',
      )}
    >
      {/* Always-visible checkbox */}
      <button
        onClick={() => onToggleSelect(task.id)}
        className="mt-1.5 shrink-0 cursor-pointer"
        aria-label={isSelected ? t.library.deselectAll : t.library.select}
      >
        <div
          className={cn(
            'flex size-4.5 items-center justify-center rounded border-2 transition-colors',
            isSelected
              ? 'bg-primary border-primary'
              : 'border-muted-foreground/40 group-hover:border-muted-foreground/60',
          )}
        >
          {isSelected && <Check className="text-primary-foreground size-3" />}
        </div>
      </button>

      {/* Status icon */}
      <div
        className={cn('mt-1 shrink-0 rounded-full p-1', statusConfig.bg)}
        aria-label={`Status: ${task.status || 'unknown'}`}
      >
        <StatusIcon
          className={cn(
            'size-3.5',
            statusConfig.color,
            statusConfig.animate && 'animate-spin',
          )}
        />
      </div>

      {/* Main content — clickable */}
      <button
        onClick={() => onNavigate(task.id)}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        {/* Title row with metadata pills */}
        <div className="flex items-center gap-2">
          <h3 className="text-foreground min-w-0 truncate text-sm font-medium">
            {task.title || task.prompt || t.library.untitled}
          </h3>
          {task.favorite && (
            <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
          )}
          {isRunningBg && (
            <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-500">
              {t.library.statusRunning}
            </span>
          )}

          {/* Metadata pills — right side */}
          <div className="text-muted-foreground ml-auto flex shrink-0 items-center gap-3 text-xs">
            {profileName && (
              <span className="max-w-20 truncate" title={profileName}>
                {profileName}
              </span>
            )}
            {costStr && (
              <span className="tabular-nums" title={t.library.cost}>
                {costStr}
              </span>
            )}
            {durationStr && (
              <span className="tabular-nums" title={t.library.durationLabel}>
                {durationStr}
              </span>
            )}
          </div>
        </div>

        {/* Meta row: relative time + absolute date */}
        <div className="text-muted-foreground mt-0.5 flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatRelativeTime(task.updated_at || task.created_at, t.library)}
          </span>
          <span
            className="flex items-center gap-1 opacity-60"
            title={formatAbsoluteDate(task.created_at)}
          >
            <Calendar className="size-3" />
            {formatAbsoluteDate(task.created_at)}
          </span>
        </div>
      </button>

      {/* Open session folder */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenFolder(task.id);
        }}
        className="text-muted-foreground hover:text-foreground mt-1 shrink-0 cursor-pointer rounded-full p-1.5 opacity-0 transition-all group-hover:opacity-100"
        aria-label={t.library.openFolder}
        title={t.library.openFolder}
      >
        <FolderOpen className="size-3.5" />
      </button>

      {/* Favorite toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(task.id, !task.favorite);
        }}
        className={cn(
          'mt-1 shrink-0 cursor-pointer rounded-full p-1.5 transition-all',
          task.favorite
            ? 'text-amber-400 opacity-100'
            : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-amber-400',
        )}
        aria-label={t.library.filterFavorites}
      >
        <Heart className={cn('size-3.5', task.favorite && 'fill-current')} />
      </button>
    </motion.div>
  );
});
