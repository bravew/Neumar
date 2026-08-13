import type { TranslationKeys } from '@/config/locale';

import type { CommentAttachmentLabels } from './CommentAttachmentInput';

export type FileViewerPreviewLabels = {
  copy: string;
  copied: string;
  save: string;
  saving: string;
  fastStartNote: string;
  previewUnavailable: string;
  jsxModuleNotice: string;
  fitLabel: string;
  drawClear: string;
  sendToChat: string;
  drawStrokeCount: string;
  close: string;
  pinHeader: string;
  targetedChangePlaceholder: string;
  commentPlaceholder: string;
  comment: string;
  send: string;
} & CommentAttachmentLabels;

export function fileViewerPreviewLabels(t: TranslationKeys) {
  return {
    copy: t.design.copy,
    copied: t.design.exportCopiedPath,
    save: t.design.save,
    saving: t.design.saving,
    fastStartNote: t.design.mp4FastStartNote,
    previewUnavailable: t.design.previewUnavailable,
    jsxModuleNotice: t.design.jsxModuleNotice,
    fitLabel: t.design.fitPercent,
    drawClear: t.design.drawClear,
    sendToChat: t.design.sendToChat,
    drawStrokeCount: t.design.drawStrokeCount,
    close: t.common.close,
    pinHeader: t.design.pinHeader,
    targetedChangePlaceholder: t.design.targetedChangePlaceholder,
    commentPlaceholder: t.design.commentPlaceholder,
    comment: t.design.comment,
    send: t.design.send,
    attachmentDropzone: t.design.commentAttachmentDropzone,
    attachmentChooseImage: t.design.commentAttachmentChooseImage,
    attachmentAddNote: t.design.commentAttachmentAddNote,
    attachmentNotePlaceholder: t.design.commentAttachmentNotePlaceholder,
    attachmentRemove: t.design.commentAttachmentRemove,
    attachmentImageAlt: t.design.commentAttachmentImageAlt,
    attachmentLimit: t.design.commentAttachmentLimit,
    attachmentImageTooLarge: t.design.commentAttachmentImageTooLarge,
    attachmentImageUnsupported: t.design.commentAttachmentImageUnsupported,
    attachmentImageReadFailed: t.design.commentAttachmentImageReadFailed,
    commentImageAttachmentLabel: t.design.commentImageAttachmentLabel,
    commentNoteAttachmentLabel: t.design.commentNoteAttachmentLabel,
  } satisfies FileViewerPreviewLabels;
}
