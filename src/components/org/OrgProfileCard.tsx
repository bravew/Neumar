import { Edit2, Pause, Play, Plus, Trash2 } from 'lucide-react';

import { AvatarSvg } from '@/components/profiles/avatar-options';
import {
  AnimatePresence,
  cardHover,
  fadeScale,
  motion,
  SCALE,
  SPRING,
} from '@/config/animation';
import { cn } from '@/shared/lib/utils';
import type { useLanguage } from '@/shared/providers/language-provider';
import type { AgentProfile } from '@/shared/types/agent-profile';

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-500',
  paused: 'bg-amber-500',
  archived: 'bg-gray-400',
};

export function OrgProfileCard({
  profile,
  onNewTask,
  onEdit,
  onDelete,
  onStatusChange,
  deleteConfirmId,
  onConfirmDelete,
  onCancelDelete,
  t,
}: {
  profile: AgentProfile;
  onNewTask: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (
    p: AgentProfile,
    s: 'active' | 'paused' | 'archived',
  ) => void;
  deleteConfirmId: string | null;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  const isDeleting = deleteConfirmId === profile.id;

  const statusLabel =
    profile.status === 'active'
      ? t.profiles.active
      : profile.status === 'paused'
        ? t.profiles.paused
        : t.profiles.archived;

  return (
    <motion.div
      variants={cardHover}
      whileHover="hover"
      whileTap="tap"
      className="bg-card border-border group relative flex flex-col rounded-xl border p-5 transition-shadow hover:shadow-md"
    >
      {/* Avatar + status indicator */}
      <div className="mb-3 flex items-start justify-between">
        <AvatarSvg
          avatarId={profile.avatar_icon}
          color={profile.avatar_color || '#6366f1'}
          className="size-12 shrink-0 overflow-hidden rounded-xl"
        />
        <div className="flex items-center gap-1.5">
          <motion.span
            key={profile.status}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...SPRING.bouncy }}
            className={cn(
              'size-2 rounded-full',
              STATUS_COLOR[profile.status] ?? 'bg-gray-400',
              profile.status === 'active' && 'animate-pulse',
            )}
          />
          <span className="text-muted-foreground text-xs capitalize">
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Name + role */}
      <h3 className="text-foreground truncate font-semibold">{profile.name}</h3>
      {profile.role && (
        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {profile.role}
        </p>
      )}

      {/* Meta: task count + runtime */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {typeof profile.task_count === 'number' && profile.task_count > 0 && (
          <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
            {t.profiles.taskCount.replace(
              '{count}',
              String(profile.task_count),
            )}
          </span>
        )}
        {profile.runtime_id && (
          <span className="text-muted-foreground/60 truncate text-xs">
            {profile.runtime_id}
          </span>
        )}
      </div>

      {/* New Task CTA */}
      <div className="mt-4">
        <motion.button
          whileTap={{ scale: SCALE.tap }}
          onClick={onNewTask}
          disabled={profile.status !== 'active'}
          className={cn(
            'flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            profile.status === 'active'
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          <Plus className="size-3.5" />
          {t.profiles.newTask}
        </motion.button>
      </div>

      {/* Hover action buttons */}
      <div className="absolute top-10 right-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
          title={t.profiles.editProfile}
        >
          <Edit2 className="size-3.5" />
        </button>
        {profile.status === 'active' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStatusChange(profile, 'paused');
            }}
            className="text-muted-foreground rounded p-1 transition-colors hover:text-amber-500"
            title={t.profiles.paused}
          >
            <Pause className="size-3.5" />
          </button>
        ) : profile.status === 'paused' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStatusChange(profile, 'active');
            }}
            className="text-muted-foreground rounded p-1 transition-colors hover:text-green-500"
            title={t.profiles.active}
          >
            <Play className="size-3.5" />
          </button>
        ) : null}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-muted-foreground hover:text-destructive rounded p-1 transition-colors"
          title={t.profiles.deleteProfile}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Delete confirmation overlay */}
      <AnimatePresence>
        {isDeleting && (
          <motion.div
            variants={fadeScale}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="bg-card border-border absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl border p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-foreground text-center text-sm">
              {t.profiles.confirmDelete}
            </p>
            <div className="flex gap-2">
              <motion.button
                whileTap={{ scale: SCALE.tap }}
                onClick={() => onConfirmDelete(profile.id)}
                className="bg-destructive text-destructive-foreground rounded-lg px-3 py-1.5 text-sm font-medium"
              >
                {t.common.delete}
              </motion.button>
              <motion.button
                whileTap={{ scale: SCALE.tap }}
                onClick={onCancelDelete}
                className="text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5 text-sm"
              >
                {t.common.cancel}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
