import { useEffect, useState } from 'react';

import type { NeumaTargetPayload } from '@/components/artifacts/live/iframe-sandbox';
import {
  deleteDesignComment,
  listDesignComments,
  postDesignComment,
  updateDesignComment,
} from '@/shared/hooks/useDesignMode';
import type {
  DesignComment,
  DesignCommentAttachment,
  DrawStroke,
} from '@/shared/types/design-mode';
import { randomUUID } from '@/shared/utils/uuid';

import type { PreviewMode } from './PreviewModeSegments';

export function useFileViewerComments({
  projectId,
  path,
  effectiveMode,
}: {
  projectId: string;
  path: string | null;
  effectiveMode: PreviewMode;
}) {
  const [comments, setComments] = useState<DesignComment[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (effectiveMode !== 'comment') return;
    const ac = new AbortController();
    listDesignComments(projectId, { signal: ac.signal })
      .then((result) => setComments(result.comments))
      .catch(() => {
        if (!ac.signal.aborted) setComments([]);
      });
    return () => ac.abort();
  }, [effectiveMode, projectId]);

  const refresh = async () => {
    const result = await listDesignComments(projectId);
    setComments(result.comments);
  };

  const submitTargetComment = async ({
    target,
    text,
    attachToChat,
    attachments,
  }: {
    target: NeumaTargetPayload;
    text: string;
    attachToChat: boolean;
    attachments?: DesignCommentAttachment[];
  }) => {
    if (!path || !text.trim()) return;
    setSaving(true);
    try {
      await postDesignComment(projectId, {
        target: {
          ...target,
          file: path,
          ...(target.pin ? { x: target.pin.x, y: target.pin.y } : {}),
        },
        text: text.trim(),
        attachToChat,
        ...(attachments?.length ? { attachments } : {}),
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const submitDrawComment = async ({
    strokes,
    viewport,
    label,
    text,
  }: {
    strokes: DrawStroke[];
    viewport: { width: number; height: number; scale: number };
    label: string;
    text: string;
  }) => {
    if (!path) return;
    setSaving(true);
    try {
      await postDesignComment(projectId, {
        target: {
          id: `draw_${randomUUID()}`,
          role: 'draw',
          label,
          file: path,
        },
        text,
        attachToChat: true,
        attachments: [{ kind: 'draw', strokes, viewport }],
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const resolveComment = async (comment: DesignComment) => {
    const result = await updateDesignComment(projectId, comment.id, {
      status: 'resolved',
    });
    setComments(result.comments);
  };

  const deleteComment = async (comment: DesignComment) => {
    const result = await deleteDesignComment(projectId, comment.id);
    setComments(result.comments);
  };

  return {
    comments,
    saving,
    submitTargetComment,
    submitDrawComment,
    resolveComment,
    deleteComment,
  };
}
