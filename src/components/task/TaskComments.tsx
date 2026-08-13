import { useCallback, useEffect, useState } from 'react';

import { Bot, Loader2, MessageCircle, Send, User, Zap } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

interface Comment {
  id: string;
  task_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

interface TaskCommentsProps {
  taskId: string;
}

const AUTHOR_ICONS: Record<string, typeof User> = {
  user: User,
  agent: Bot,
  system: Zap,
};

const AUTHOR_COLORS: Record<string, string> = {
  user: 'bg-blue-500/10 text-blue-500',
  agent: 'bg-purple-500/10 text-purple-500',
  system: 'bg-gray-500/10 text-gray-500',
};

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

export function TaskComments({ taskId }: TaskCommentsProps) {
  const { t } = useLanguage();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchComments = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`${API_BASE_URL}/db/tasks/${taskId}/comments`, {
          signal,
        });
        if (res.ok) setComments(await res.json());
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchComments(controller.signal);
    return () => controller.abort();
  }, [fetchComments]);

  const handleSubmit = useCallback(async () => {
    if (!newContent.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/db/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: randomUUID(),
          task_id: taskId,
          author_type: 'user',
          content: newContent.trim(),
        }),
      });
      if (res.ok) {
        setNewContent('');
        fetchComments();
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }, [newContent, submitting, taskId, fetchComments]);

  return (
    <div className="space-y-3">
      <h3 className="text-foreground flex items-center gap-2 text-sm font-medium">
        <MessageCircle className="size-4" />
        {t.task.comments ?? 'Comments'}
        {comments.length > 0 && (
          <span className="text-muted-foreground text-xs">
            ({comments.length})
          </span>
        )}
      </h3>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        </div>
      ) : (
        <>
          {comments.length === 0 && (
            <p className="text-muted-foreground py-2 text-sm">
              {t.task.noComments ?? 'No comments yet'}
            </p>
          )}
          <div className="space-y-2">
            {comments.map((comment) => {
              const Icon = AUTHOR_ICONS[comment.author_type] || User;
              return (
                <div key={comment.id} className="flex gap-2">
                  <div
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full',
                      AUTHOR_COLORS[comment.author_type] ||
                        'bg-gray-500/10 text-gray-500',
                    )}
                  >
                    <Icon className="size-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-xs font-medium">
                        {{
                          user: t.task.commentAuthorUser,
                          agent: t.task.commentAuthorAgent,
                          system: t.task.commentAuthorSystem,
                        }[comment.author_type] ?? comment.author_type}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatTimeAgo(comment.created_at, {
                          justNow: t.dashboard.justNow,
                          mAgo: t.dashboard.minutesAgo,
                          hAgo: t.dashboard.hoursAgo,
                          dAgo: t.dashboard.daysAgo,
                        })}
                      </span>
                    </div>
                    <p className="text-foreground mt-0.5 text-sm">
                      {comment.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add comment */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder={t.task.addComment ?? 'Add a comment...'}
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          className="bg-background border-border text-foreground flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          onClick={handleSubmit}
          disabled={!newContent.trim() || submitting}
          className="bg-primary text-primary-foreground flex items-center justify-center rounded-lg px-3 py-2 disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
