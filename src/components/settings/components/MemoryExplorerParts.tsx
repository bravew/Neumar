/**
 * Shared types, constants, helpers, and sub-components for MemoryExplorer.
 */

import type React from 'react';

import { Activity, Clock, Globe, Layers, Pin, Users, X } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ── Types ──

export interface MemoryV2 {
  id: string;
  content: string;
  category: string;
  importance: number;
  source: string;
  memoryType: string;
  scopeType: string;
  scopeId: string | null;
  confidence: number;
  decayRate: number;
  lifecycleStatus: string;
  language: string | null;
  hasEmbedding: boolean;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  parentId: string | null;
  consolidatedFrom: string[] | null;
  metadata: Record<string, unknown> | null;
}

export interface SearchResult {
  memory: MemoryV2;
  score: number;
}

export interface MemoryAnalytics {
  total: number;
  withEmbeddings: number;
  byCategory: Record<string, number>;
  byType?: Record<string, number>;
  byScope?: Record<string, number>;
  byLifecycle?: Record<string, number>;
  entities?: {
    totalEntities: number;
    totalEdges: number;
    byType: Record<string, number>;
  };
  consolidation?: {
    lastRun: { runAt: string; memoriesMerged: number } | null;
  };
}

export interface EntityItem {
  id: string;
  name: string;
  entityType: string;
  summary: string | null;
  mentionCount: number;
  lastSeenAt: string;
}

// ── Constants ──

export const MEMORY_TYPES = [
  'episodic',
  'semantic',
  'procedural',
  'pinned',
] as const;
export const SCOPE_TYPES = ['global', 'profile', 'project', 'session'] as const;
export const LIFECYCLE_STATUSES = ['active', 'stale', 'archived'] as const;
export const CATEGORIES = [
  'preference',
  'fact',
  'decision',
  'entity',
  'other',
  'interaction',
  'tool_pattern',
  'correction',
  'workflow',
] as const;

export const TYPE_COLORS: Record<string, string> = {
  episodic: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  semantic: 'bg-green-500/15 text-green-700 dark:text-green-400',
  procedural: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  pinned: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};

export const LIFECYCLE_COLORS: Record<string, string> = {
  active: 'bg-green-500/15 text-green-700 dark:text-green-400',
  stale: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  archived: 'bg-gray-500/15 text-gray-500 dark:text-gray-400',
};

export const SCOPE_ICONS: Record<string, typeof Globe> = {
  global: Globe,
  profile: Users,
  project: Layers,
  session: Clock,
};

export const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

const BADGE_CLASS =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

// ── Helpers ──

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function strengthPercent(memory: MemoryV2): number {
  if (memory.memoryType === 'pinned') return 100;
  const ref = memory.lastAccessedAt ?? memory.createdAt;
  const daysSince =
    (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 0) return Math.round(memory.importance * 100);
  return Math.round(
    memory.importance * Math.exp(-memory.decayRate * daysSince) * 100,
  );
}

// ── Sub-components ──

export function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  color?: string;
}) {
  return (
    <div className="bg-muted/30 flex items-center gap-3 rounded-lg p-3">
      <div
        className={cn('rounded-md p-2', color ?? 'bg-primary/10 text-primary')}
      >
        <Icon size={16} />
      </div>
      <div>
        <p className="text-foreground text-lg leading-tight font-semibold">
          {value}
        </p>
        <p className="text-muted-foreground text-xs">{label}</p>
      </div>
    </div>
  );
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn(BADGE_CLASS, className)}>{children}</span>;
}

export function StrengthBar({ percent }: { percent: number }) {
  const color =
    percent > 70
      ? 'bg-green-500'
      : percent > 40
        ? 'bg-yellow-500'
        : percent > 15
          ? 'bg-orange-500'
          : 'bg-red-500';
  return (
    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

export function MemoryDetailPanel({
  memory,
  onClose,
  onPin,
}: {
  memory: MemoryV2;
  onClose: () => void;
  onPin: (id: string, unpin: boolean) => void;
}) {
  const { t } = useLanguage();
  const strength = strengthPercent(memory);
  const ScopeIcon = SCOPE_ICONS[memory.scopeType] ?? Globe;

  return (
    <div className="memory-detail-panel border-border bg-background animate-in slide-in-from-right-2 border-l p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-foreground text-sm font-medium">
          {t.settings.memoryViewMemory ?? 'Memory Details'}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground rounded p-1"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4 text-sm">
        <div className="bg-muted/30 rounded-md p-3">
          <p className="text-foreground break-words whitespace-pre-wrap">
            {memory.content}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge className={TYPE_COLORS[memory.memoryType] ?? ''}>
            {memory.memoryType}
          </Badge>
          <Badge className="bg-muted text-foreground">{memory.category}</Badge>
          <Badge className={LIFECYCLE_COLORS[memory.lifecycleStatus] ?? ''}>
            {memory.lifecycleStatus}
          </Badge>
          <Badge className="bg-muted/50 text-muted-foreground">
            <ScopeIcon size={10} className="mr-1" />
            {memory.scopeType}
            {memory.scopeId ? `: ${memory.scopeId.slice(0, 8)}` : ''}
          </Badge>
          {memory.language && (
            <Badge className="bg-muted/50 text-muted-foreground">
              {memory.language}
            </Badge>
          )}
        </div>

        <div>
          <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
            <span>{t.settings.memoryStrength ?? 'Strength'}</span>
            <span>{strength}%</span>
          </div>
          <StrengthBar percent={strength} />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">
              {t.settings.memoryConfidence ?? 'Confidence'}
            </span>
            <p className="text-foreground font-medium">
              {Math.round(memory.confidence * 100)}%
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">
              {t.settings.memoryColImportance ?? 'Importance'}
            </span>
            <p className="text-foreground font-medium">
              {Math.round(memory.importance * 100)}%
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">
              {t.settings.memoryColSource ?? 'Source'}
            </span>
            <p className="text-foreground font-medium">{memory.source}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Accessed</span>
            <p className="text-foreground font-medium">
              {memory.accessCount}x
              {memory.lastAccessedAt
                ? ` (${timeAgo(memory.lastAccessedAt)})`
                : ''}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">
              {t.settings.memoryColCreatedAt ?? 'Created'}
            </span>
            <p className="text-foreground font-medium">
              {timeAgo(memory.createdAt)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Decay rate</span>
            <p className="text-foreground font-medium">
              {memory.memoryType === 'pinned'
                ? 'None'
                : `${(memory.decayRate * 100).toFixed(1)}%/day`}
            </p>
          </div>
        </div>

        {memory.consolidatedFrom && memory.consolidatedFrom.length > 0 && (
          <div className="text-xs">
            <span className="text-muted-foreground">Consolidated from:</span>
            <p className="text-foreground font-mono">
              {memory.consolidatedFrom.length} memories
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => onPin(memory.id, memory.memoryType === 'pinned')}
          className={cn(
            'memory-history-affordance flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            memory.memoryType === 'pinned'
              ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400'
              : 'bg-muted hover:bg-muted/80 text-foreground',
          )}
        >
          <Pin size={12} />
          {memory.memoryType === 'pinned'
            ? (t.settings.memoryUnpin ?? 'Unpin')
            : (t.settings.memoryPin ?? 'Pin')}
        </button>

        <p className="text-muted-foreground/50 font-mono text-[10px]">
          {memory.id}
        </p>
      </div>
    </div>
  );
}
