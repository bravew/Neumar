import {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';

import { ImagePlus, Plus, StickyNote, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type {
  ImageCommentAttachment,
  NoteCommentAttachment,
} from '@/shared/types/design-mode';
import { randomUUID } from '@/shared/utils/uuid';

const MAX_COMMENT_ATTACHMENTS = 8;
const MAX_COMMENT_IMAGE_BYTES = 2 * 1024 * 1024;
const COMMENT_IMAGE_MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
} as const;
const COMMENT_IMAGE_TYPES = Object.keys(COMMENT_IMAGE_MIME_TO_EXT);

export type EditableCommentAttachment =
  | (ImageCommentAttachment & { id: string })
  | (NoteCommentAttachment & { id: string });

export interface CommentAttachmentLabels {
  attachmentDropzone: string;
  attachmentChooseImage: string;
  attachmentAddNote: string;
  attachmentNotePlaceholder: string;
  attachmentRemove: string;
  attachmentImageAlt: string;
  attachmentLimit: string;
  attachmentImageTooLarge: string;
  attachmentImageUnsupported: string;
  attachmentImageReadFailed: string;
  commentImageAttachmentLabel: string;
  commentNoteAttachmentLabel: string;
}

interface CommentAttachmentInputProps {
  attachments: EditableCommentAttachment[];
  labels: CommentAttachmentLabels;
  onChange: (attachments: EditableCommentAttachment[]) => void;
}

export function CommentAttachmentInput({
  attachments,
  labels,
  onChange,
}: CommentAttachmentInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const next = [...attachments];
      setError(null);
      for (const file of Array.from(files)) {
        if (next.length >= MAX_COMMENT_ATTACHMENTS) {
          setError(labels.attachmentLimit);
          break;
        }
        if (!isSupportedCommentImage(file.type)) {
          setError(labels.attachmentImageUnsupported);
          continue;
        }
        if (file.size > MAX_COMMENT_IMAGE_BYTES) {
          setError(labels.attachmentImageTooLarge);
          continue;
        }
        try {
          next.push({
            id: randomUUID(),
            kind: 'image',
            name: sanitizeAttachmentName(file.name, file.type),
            mime: file.type,
            size: file.size,
            dataUrl: await readFileAsDataUrl(file),
          });
        } catch {
          setError(labels.attachmentImageReadFailed);
        }
      }
      onChange(next);
    },
    [attachments, labels, onChange],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer.files.length > 0) {
        void addFiles(event.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.clipboardData.files.length > 0) {
        void addFiles(event.clipboardData.files);
      }
    },
    [addFiles],
  );

  const addNote = () => {
    if (attachments.length >= MAX_COMMENT_ATTACHMENTS) {
      setError(labels.attachmentLimit);
      return;
    }
    onChange([...attachments, { id: randomUUID(), kind: 'note', text: '' }]);
  };

  const updateAttachment = (
    attachment: EditableCommentAttachment,
    index: number,
  ) => {
    onChange(
      attachments.map((item, itemIndex) =>
        itemIndex === index ? attachment : item,
      ),
    );
  };

  const removeAttachment = (index: number) => {
    onChange(attachments.filter((_, itemIndex) => itemIndex !== index));
  };

  const atLimit = attachments.length >= MAX_COMMENT_ATTACHMENTS;

  return (
    <div className="mt-3 space-y-2">
      <div
        role="group"
        aria-label={labels.attachmentDropzone}
        className="border-border bg-muted/30 rounded-md border border-dashed p-2"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        <p className="text-muted-foreground text-xs">
          {labels.attachmentDropzone}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={COMMENT_IMAGE_TYPES.join(',')}
            multiple
            className="sr-only"
            aria-label={labels.attachmentChooseImage}
            onChange={(event) => {
              if (event.currentTarget.files) {
                void addFiles(event.currentTarget.files);
              }
              event.currentTarget.value = '';
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            disabled={atLimit}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="size-3.5" />
            {labels.attachmentChooseImage}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            disabled={atLimit}
            onClick={addNote}
          >
            <Plus className="size-3.5" />
            {labels.attachmentAddNote}
          </Button>
        </div>
        {error && (
          <p className="text-destructive mt-2 text-[11px]" role="alert">
            {error}
          </p>
        )}
      </div>

      {attachments.length > 0 && (
        <ul className="space-y-2">
          {attachments.map((attachment, index) => (
            <li
              key={attachment.id}
              className="border-border bg-background rounded-md border p-2"
            >
              {attachment.kind === 'image' ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    {attachment.dataUrl && (
                      <img
                        src={attachment.dataUrl}
                        alt=""
                        className="bg-muted size-12 rounded object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {attachment.name}
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        {labels.commentImageAttachmentLabel.replace(
                          '{size}',
                          formatBytes(attachment.size),
                        )}
                      </p>
                    </div>
                    <RemoveAttachmentButton
                      label={labels.attachmentRemove}
                      onRemove={() => removeAttachment(index)}
                    />
                  </div>
                  <input
                    value={attachment.alt ?? ''}
                    className="border-input h-8 w-full rounded border px-2 text-xs"
                    aria-label={labels.attachmentImageAlt.replace(
                      '{name}',
                      attachment.name,
                    )}
                    placeholder={labels.attachmentImageAlt.replace(
                      '{name}',
                      attachment.name,
                    )}
                    onChange={(event) =>
                      updateAttachment(
                        { ...attachment, alt: event.currentTarget.value },
                        index,
                      )
                    }
                  />
                </div>
              ) : attachment.kind === 'note' ? (
                <div className="flex gap-2">
                  <StickyNote className="text-muted-foreground mt-2 size-4 shrink-0" />
                  <textarea
                    value={attachment.text}
                    aria-label={labels.attachmentNotePlaceholder}
                    className="border-input min-h-16 flex-1 resize-none rounded border p-2 text-xs"
                    placeholder={labels.attachmentNotePlaceholder}
                    onChange={(event) =>
                      updateAttachment(
                        { ...attachment, text: event.currentTarget.value },
                        index,
                      )
                    }
                  />
                  <RemoveAttachmentButton
                    label={labels.attachmentRemove}
                    onRemove={() => removeAttachment(index)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RemoveAttachmentButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      onClick={onRemove}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

function isSupportedCommentImage(
  mime: string,
): mime is keyof typeof COMMENT_IMAGE_MIME_TO_EXT {
  return Object.prototype.hasOwnProperty.call(COMMENT_IMAGE_MIME_TO_EXT, mime);
}

function sanitizeAttachmentName(
  name: string,
  mime: keyof typeof COMMENT_IMAGE_MIME_TO_EXT,
) {
  const ext = COMMENT_IMAGE_MIME_TO_EXT[mime];
  const stem =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9_.-]/g, '-')
      .replace(/^[^A-Za-z0-9_]+/, '')
      .slice(0, 80) || 'image';
  return `${stem}${ext}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader returned an empty result.'));
      }
    });
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
