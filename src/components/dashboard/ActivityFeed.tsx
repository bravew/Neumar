import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import {
  CircleCheck,
  CirclePlus,
  FolderKanban,
  Loader2,
  MessageCircle,
  Target,
  Zap,
} from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface ActivityEvent {
  id: string;
  actor_type: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  metadata: string | null;
  created_at: string;
}

const EVENT_ICONS: Record<string, typeof Zap> = {
  'task.created': CirclePlus,
  'task.status_changed': CircleCheck,
  'task.comment_added': MessageCircle,
  'project.created': FolderKanban,
  'project.archived': FolderKanban,
  'goal.created': Target,
  'goal.completed': Target,
};

function formatEventDescription(
  event: ActivityEvent,
  eventLabels: Record<string, string>,
): string {
  if (eventLabels[event.event_type]) return eventLabels[event.event_type];
  const parts = event.event_type.split('.');
  const entity = parts[0] || 'item';
  const action = (parts[1] || 'updated').replace(/_/g, ' ');
  return `${entity} ${action}`;
}

function formatTimeAgo(
  dateStr: string,
  labels: { justNow: string; mAgo: string; hAgo: string; dAgo: string },
): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return labels.justNow;
  if (mins < 60) return labels.mAgo.replace('{count}', String(mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return labels.hAgo.replace('{count}', String(hours));
  const days = Math.floor(hours / 24);
  return labels.dAgo.replace('{count}', String(days));
}

export function ActivityFeed() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/db/activity?limit=20`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t.dashboard.noActivity}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((event) => {
        const Icon = EVENT_ICONS[event.event_type] || Zap;
        return (
          <button
            key={event.id}
            onClick={() => {
              if (event.entity_type === 'task' && event.entity_id) {
                navigate(`/task-v2/${event.entity_id}`, { state: null });
              } else if (event.entity_type === 'project' && event.entity_id) {
                navigate(`/projects/${event.entity_id}`);
              }
            }}
            className={cn(
              'hover:bg-accent/50 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
              event.entity_id && 'cursor-pointer',
            )}
          >
            <Icon className="text-muted-foreground size-4 shrink-0" />
            <span className="text-foreground min-w-0 flex-1 truncate text-sm capitalize">
              {formatEventDescription(event, t.dashboard.events)}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatTimeAgo(event.created_at, {
                justNow: t.dashboard.justNow,
                mAgo: t.dashboard.minutesAgo,
                hAgo: t.dashboard.hoursAgo,
                dAgo: t.dashboard.daysAgo,
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
