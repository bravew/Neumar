import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { designBlobUrl } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignComment,
  DesignCommentAttachment,
} from '@/shared/types/design-mode';

export function CommentRail({
  projectId,
  comments = [],
  activeFile,
  collapsed = false,
  onResolve,
  onDelete,
  onCollapsedChange,
}: {
  projectId?: string;
  comments?: DesignComment[];
  activeFile?: string | null;
  collapsed?: boolean;
  onResolve?: (comment: DesignComment) => void;
  onDelete?: (comment: DesignComment) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const { t } = useLanguage();
  const visible = activeFile
    ? comments.filter(
        (comment) =>
          !comment.target?.file || comment.target.file === activeFile,
      )
    : comments;
  const openComments = visible.filter(
    (comment) => comment.status !== 'resolved',
  );
  const resolvedComments = visible.filter(
    (comment) => comment.status === 'resolved',
  );

  if (collapsed) {
    return (
      <aside className="border-border bg-card flex w-12 shrink-0 items-start justify-center border-l p-2 text-sm">
        <button
          type="button"
          className="hover:bg-muted flex min-h-32 w-8 flex-col items-center justify-center gap-2 rounded-md text-xs"
          aria-label={t.design.commentRailExpand}
          onClick={() => onCollapsedChange?.(false)}
        >
          <ChevronLeft className="size-4" />
          <span className="vertical-rl [writing-mode:vertical-rl]">
            {t.design.comments}
          </span>
          {visible.length > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px]">
              {visible.length}
            </span>
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside className="border-border bg-card w-72 shrink-0 overflow-auto border-l p-3 text-sm transition-transform motion-reduce:transition-none">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t.design.comments}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.design.commentRailCollapse}
          onClick={() => onCollapsedChange?.(true)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {visible.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {t.design.noComments}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <CommentList
            label={`${t.design.openComments} (${openComments.length})`}
            comments={openComments}
            projectId={projectId}
            onResolve={onResolve}
            onDelete={onDelete}
          />
          {resolvedComments.length > 0 && (
            <details>
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium">
                {t.design.resolvedComments.replace(
                  '{count}',
                  String(resolvedComments.length),
                )}
              </summary>
              <CommentList
                comments={resolvedComments}
                projectId={projectId}
                onDelete={onDelete}
                className="mt-2"
              />
            </details>
          )}
        </div>
      )}
    </aside>
  );
}

function CommentList({
  label,
  comments,
  projectId,
  className,
  onResolve,
  onDelete,
}: {
  label?: string;
  comments: DesignComment[];
  projectId?: string;
  className?: string;
  onResolve?: (comment: DesignComment) => void;
  onDelete?: (comment: DesignComment) => void;
}) {
  const { t } = useLanguage();
  if (comments.length === 0) return null;
  return (
    <section className={className}>
      {label && (
        <h3 className="text-muted-foreground mb-2 text-xs font-medium">
          {label}
        </h3>
      )}
      <ol className="space-y-2">
        {comments.map((comment) => (
          <li key={comment.id} className="rounded-md border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  className="truncate text-xs font-medium"
                  title={comment.target?.file}
                >
                  {comment.target?.label ||
                    comment.target?.id ||
                    comment.target?.file ||
                    t.design.comment}
                </p>
                <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
                  {comment.status === 'resolved'
                    ? t.design.commentStatusResolved
                    : t.design.commentStatusOpen}{' '}
                  · {formatDate(comment.createdAt)}
                </p>
              </div>
              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.design.deleteComment}
                  onClick={() => onDelete(comment)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs break-words">{comment.text}</p>
            {comment.attachments?.map((attachment, index) => (
              <CommentAttachmentPreview
                key={`${comment.id}-attachment-${index}`}
                attachment={attachment}
                projectId={projectId}
              />
            ))}
            {comment.status !== 'resolved' && onResolve && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-7 px-2 text-xs"
                onClick={() => onResolve(comment)}
              >
                {t.design.resolveComment}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function CommentAttachmentPreview({
  attachment,
  projectId,
}: {
  attachment: DesignCommentAttachment;
  projectId?: string;
}) {
  const { t } = useLanguage();
  if (attachment.kind === 'draw') {
    return (
      <p className="text-muted-foreground bg-muted mt-2 rounded px-2 py-1 text-[11px]">
        {t.design.drawAttachmentLabel.replace(
          '{count}',
          String(attachment.strokes.length),
        )}
      </p>
    );
  }
  if (attachment.kind === 'note') {
    return (
      <p className="text-muted-foreground bg-muted mt-2 rounded px-2 py-1 text-[11px] break-words">
        {t.design.commentNoteAttachmentLabel}: {attachment.text}
      </p>
    );
  }
  const imageSrc =
    attachment.dataUrl ||
    (projectId && attachment.path
      ? designBlobUrl(projectId, attachment.path)
      : undefined);
  return (
    <figure className="bg-muted mt-2 rounded p-2">
      {imageSrc && (
        <img
          src={imageSrc}
          alt={attachment.alt || attachment.name}
          className="max-h-24 w-full rounded object-cover"
        />
      )}
      <figcaption className="text-muted-foreground mt-1 truncate text-[11px]">
        {attachment.name}
      </figcaption>
    </figure>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
