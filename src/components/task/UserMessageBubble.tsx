import { useCallback, useRef, useState } from 'react';

import { Check, Copy, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  ATTACHED_FILES_PREFIX_RE,
  FileAttachmentChip,
  ImageAttachmentPreview,
} from './message-shared';

interface UserMessageBubbleProps {
  messageId: string;
  content: string | undefined;
  attachments?: MessageAttachment[];
  onEditMessage?: (messageId: string, newContent: string) => void;
}

export function UserMessageBubble({
  messageId,
  content,
  attachments,
  onEditMessage,
}: UserMessageBubbleProps) {
  const { t } = useLanguage();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const displayContent = content?.replace(ATTACHED_FILES_PREFIX_RE, '');

  const imageAtts = attachments?.filter((a) => a.type === 'image' && a.data);
  const fileAtts = attachments?.filter((a) => a.type !== 'image' || !a.data);
  const hasImages = imageAtts && imageAtts.length > 0;
  const hasFiles = fileAtts && fileAtts.length > 0;

  const handleStartEdit = useCallback(() => {
    setEditText(displayContent ?? '');
    setIsEditing(true);
    // Focus textarea after render
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [displayContent]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditText('');
  }, []);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === displayContent) {
      handleCancelEdit();
      return;
    }
    onEditMessage?.(messageId, trimmed);
    setIsEditing(false);
    setEditText('');
  }, [editText, displayContent, messageId, onEditMessage, handleCancelEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancelEdit();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSaveEdit();
      }
    },
    [handleCancelEdit, handleSaveEdit],
  );

  const handleCopy = useCallback(async () => {
    if (!displayContent) return;
    await copyText(displayContent);
    toast.success(t.task.copied);
  }, [displayContent, t.task.copied]);

  if (isEditing) {
    return (
      <div className="mb-4">
        <div className="flex justify-end">
          <div className="w-fit max-w-[85%] min-w-[240px]">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              className="border-border/60 bg-user-message text-user-message-foreground focus:border-primary/50 focus:ring-primary/20 field-sizing-content w-full resize-none overflow-hidden rounded-2xl border px-4 py-2.5 text-sm break-words focus:ring-2 focus:outline-none"
              rows={1}
            />
            <TooltipProvider delayDuration={0}>
              <div className="mt-1.5 flex items-center justify-end gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleCancelEdit}
                      className="text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer rounded-lg p-1.5 transition-colors"
                      aria-label={t.task.editMessageCancel}
                    >
                      <X className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t.task.editMessageCancel}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleSaveEdit}
                      disabled={
                        !editText.trim() || editText.trim() === displayContent
                      }
                      className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground cursor-pointer rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed"
                      aria-label={t.task.editMessageSave}
                    >
                      <Check className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t.task.editMessageSave}
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/user mb-4 space-y-2">
      {/* Attachments */}
      {(hasImages || hasFiles) && (
        <div className="flex justify-end">
          <div className="flex max-w-[75%] flex-row flex-wrap items-end justify-end gap-2">
            {hasImages &&
              imageAtts.map((att) => (
                <ImageAttachmentPreview key={att.id} attachment={att} />
              ))}
            {hasFiles &&
              fileAtts.map((att) => (
                <FileAttachmentChip key={att.id} attachment={att} />
              ))}
          </div>
        </div>
      )}
      {/* Text bubble with edit hover */}
      {displayContent && (
        <div className="flex items-start justify-end gap-1">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void handleCopy()}
                  className="text-muted-foreground hover:text-foreground mt-2 cursor-pointer rounded-md p-1 opacity-100 transition-opacity md:opacity-0 md:group-hover/user:opacity-100"
                  aria-label={t.task.copyMessage}
                >
                  <Copy className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t.task.copyMessage}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {onEditMessage && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleStartEdit}
                    className="text-muted-foreground hover:text-foreground mt-2 cursor-pointer rounded-md p-1 opacity-0 transition-opacity group-hover/user:opacity-100"
                    aria-label={t.task.editMessage}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {t.task.editMessage}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <p className="bg-user-message text-user-message-foreground w-fit max-w-[85%] rounded-2xl px-4 py-2.5 text-sm break-words whitespace-pre-wrap">
            {displayContent}
          </p>
        </div>
      )}
    </div>
  );
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}
