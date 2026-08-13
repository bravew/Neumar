import { useEffect, useState } from 'react';

import { X } from 'lucide-react';

import type { NeumaTargetPayload } from '@/components/artifacts/live/iframe-sandbox';
import { Button } from '@/components/ui/button';
import type { DesignCommentAttachment } from '@/shared/types/design-mode';

import {
  CommentAttachmentInput,
  type CommentAttachmentLabels,
  type EditableCommentAttachment,
} from './CommentAttachmentInput';
import type { PreviewMode } from './PreviewModeSegments';

type TargetMode = Extract<PreviewMode, 'comment' | 'edit'>;

interface FileViewerTargetCardProps {
  target: NeumaTargetPayload;
  filePath: string;
  mode: TargetMode;
  text: string;
  saving: boolean;
  labels: {
    close: string;
    pinHeader: string;
    targetedChangePlaceholder: string;
    commentPlaceholder: string;
    comment: string;
    saving: string;
    sendToChat: string;
    send: string;
  } & CommentAttachmentLabels;
  onTextChange: (text: string) => void;
  onClose: () => void;
  onSubmitEdit: () => void;
  onSubmitComment: (
    attachToChat: boolean,
    attachments: DesignCommentAttachment[],
  ) => void | Promise<void>;
}

export function FileViewerTargetCard({
  target,
  filePath,
  mode,
  text,
  saving,
  labels,
  onTextChange,
  onClose,
  onSubmitEdit,
  onSubmitComment,
}: FileViewerTargetCardProps) {
  const [attachments, setAttachments] = useState<EditableCommentAttachment[]>(
    [],
  );
  const disabled = saving || !text.trim();

  useEffect(() => {
    setAttachments([]);
  }, [filePath, target.id, target.label, target.pin?.x, target.pin?.y]);

  const submitComment = async (attachToChat: boolean) => {
    await onSubmitComment(attachToChat, submitReadyAttachments(attachments));
    setAttachments([]);
  };

  return (
    <div className="bg-background mt-3 rounded-md border p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {formatTargetHeader(target, labels.pinHeader)}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {target.role || target.tagName?.toLowerCase() || 'target'} ·{' '}
            {filePath}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="design-artifact-preview-close"
          aria-label={labels.close}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <textarea
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={
          mode === 'edit'
            ? labels.targetedChangePlaceholder
            : labels.commentPlaceholder
        }
        className="border-input mt-3 min-h-20 w-full resize-none rounded-md border p-2 text-sm outline-none"
      />
      {mode === 'comment' && (
        <CommentAttachmentInput
          attachments={attachments}
          labels={labels}
          onChange={setAttachments}
        />
      )}
      <div className="mt-2 flex justify-end gap-2">
        {mode === 'comment' ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void submitComment(false)}
            >
              {labels.comment}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() => void submitComment(true)}
            >
              {saving ? labels.saving : labels.sendToChat}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={onSubmitEdit}
          >
            {saving ? labels.saving : labels.send}
          </Button>
        )}
      </div>
    </div>
  );
}

function formatTargetHeader(target: NeumaTargetPayload, pinHeader: string) {
  if (target.role === 'pin' && target.pin) {
    return pinHeader
      .replace('{x}', String(target.pin.x))
      .replace('{y}', String(target.pin.y));
  }
  return target.label || target.id;
}

function submitReadyAttachments(attachments: EditableCommentAttachment[]) {
  return attachments.flatMap((attachment): DesignCommentAttachment[] => {
    if (attachment.kind === 'note') {
      const text = attachment.text.trim();
      return text ? [{ ...attachment, text }] : [];
    }
    const alt = attachment.alt?.trim();
    const { alt: _alt, ...rest } = attachment;
    return [{ ...rest, ...(alt ? { alt } : {}) }];
  });
}
