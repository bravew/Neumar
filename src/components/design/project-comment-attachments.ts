import {
  listDesignComments,
  updateDesignComment,
} from '@/shared/hooks/useDesignMode';

type QueuedDesignComment = Awaited<
  ReturnType<typeof listDesignComments>
>['comments'][number];

export async function loadQueuedCommentAttachments(projectId: string) {
  const result = await listDesignComments(projectId).catch(() => ({
    comments: [],
  }));
  return (Array.isArray(result.comments) ? result.comments : []).filter(
    (comment) => comment.status === 'open' && comment.attachToChat !== false,
  );
}

export function appendCommentAttachments(
  prompt: string,
  comments: QueuedDesignComment[],
) {
  if (comments.length === 0) return prompt;
  const lines = comments.map((comment, index) => {
    const target = [
      comment.target?.file,
      comment.target?.screen,
      comment.target?.label || comment.target?.id,
      comment.target?.role,
    ]
      .filter(Boolean)
      .join(' / ');
    const attachmentSummary = summarizeCommentAttachments(
      comment.attachments ?? [],
    );
    const suffix = attachmentSummary ? ` (${attachmentSummary})` : '';
    return `${index + 1}. ${target || 'preview'}: ${comment.text}${suffix}`;
  });
  return `${prompt}\n\nPreview comments to address:\n${lines.join('\n')}`;
}

export async function markCommentsAttached(
  projectId: string,
  comments: QueuedDesignComment[],
) {
  await Promise.all(
    comments.map((comment) =>
      updateDesignComment(projectId, comment.id, { attachToChat: false }),
    ),
  );
}

function summarizeCommentAttachments(
  attachments: NonNullable<QueuedDesignComment['attachments']>,
) {
  if (attachments.length === 0) return '';
  return attachments
    .map((attachment) => {
      if (attachment.kind === 'draw') {
        return `${attachment.strokes.length} drawn stroke(s)`;
      }
      if (attachment.kind === 'image') {
        return `image: ${attachment.path || attachment.name}`;
      }
      return `note: ${attachment.text}`;
    })
    .join('; ');
}
