import { useId, useState } from 'react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';

import { Files, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export interface AttachmentFilePickerProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent) => Promise<void>;
  openFilePicker: () => void;
  nativePicker: boolean;
  count: number;
}

export function AttachmentFilePicker({
  fileInputRef,
  accept,
  onFileChange,
  onDrop,
  openFilePicker,
  nativePicker,
  count,
}: AttachmentFilePickerProps) {
  const { t, tt } = useLanguage();
  const id = useId();
  const [dragging, setDragging] = useState(false);

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'border-border bg-muted/30 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center',
          dragging && 'border-primary bg-primary/5',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          void onDrop(event);
        }}
      >
        <Files className="text-muted-foreground size-8" aria-hidden="true" />
        <p className="font-medium">{t.task.attachmentDropHere}</p>
        <input
          id={id}
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          onChange={onFileChange}
          className="peer sr-only"
          aria-label={t.task.attachmentBrowse}
        />
        {nativePicker ? (
          <Button variant="outline" onClick={openFilePicker}>
            <FolderOpen className="size-4" />
            {t.task.attachmentBrowse}
          </Button>
        ) : (
          <label
            htmlFor={id}
            className="border-input bg-background hover:bg-accent peer-focus-visible:ring-ring inline-flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium peer-focus-visible:ring-2"
          >
            <FolderOpen className="size-4" aria-hidden="true" />
            {t.task.attachmentBrowse}
          </label>
        )}
      </div>
      {count > 0 ? (
        <p role="status" className="text-muted-foreground text-sm">
          {tt('task.attachmentSelectedCount', { count })}
        </p>
      ) : null}
    </div>
  );
}
