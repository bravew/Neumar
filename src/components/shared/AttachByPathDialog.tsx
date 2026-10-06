/**
 * "Attach by path" dialog.
 *
 * A browser cannot see the path of a picked file, so a large local file would
 * have to be uploaded. The local API can read a typed path in place instead.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  canAttachLocalPaths,
  normalizePathInput,
} from '@/shared/lib/local-path';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  AttachmentFilePicker,
  type AttachmentFilePickerProps,
} from './AttachmentFilePicker';
import type { LocalPathResult } from './useChatInputFiles';

const REASON_KEYS: Record<NonNullable<LocalPathResult['reason']>, string> = {
  not_found: 'task.attachByPathNotFound',
  not_file: 'task.attachByPathNotFile',
  denied: 'task.attachByPathDenied',
  unreachable: 'task.attachByPathUnreachable',
  not_accepted: 'task.attachByPathNotAccepted',
};

interface AttachByPathDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: (paths: string[]) => Promise<LocalPathResult[]>;
  filePicker: AttachmentFilePickerProps;
  uploadLimitMb: number;
}

export function AttachByPathDialog({
  open,
  onOpenChange,
  onAttach,
  filePicker,
  uploadLimitMb,
}: AttachByPathDialogProps) {
  const { t, tt } = useLanguage();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setText('');
      setErrors([]);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0 || busy) return;
    const entries = lines.map((raw) => ({
      raw,
      path: normalizePathInput(raw),
    }));
    const valid = entries.flatMap((e) => (e.path ? [e] : []));
    setBusy(true);
    try {
      const results =
        valid.length > 0
          ? await onAttach(valid.map((e) => e.path as string))
          : [];
      const failed = [
        ...entries
          .filter((e) => !e.path)
          .map((e) => ({
            raw: e.raw,
            message: tt('task.attachByPathNotFound', { path: e.raw }),
          })),
        ...results.flatMap((r, i) =>
          r.reason
            ? [
                {
                  raw: valid[i].raw,
                  message: tt(REASON_KEYS[r.reason], { path: r.path }),
                },
              ]
            : [],
        ),
      ];
      if (failed.length === 0) {
        handleOpenChange(false);
        return;
      }
      // Keep only what still needs fixing so a retry cannot attach twice.
      setText(failed.map((f) => f.raw).join('\n'));
      setErrors(failed.map((f) => f.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.home.addFilesOrPhotos}</DialogTitle>
          <DialogDescription>
            {filePicker.nativePicker
              ? t.task.attachmentDesktopHint
              : tt('task.attachmentUploadHint', { limit: uploadLimitMb })}
          </DialogDescription>
        </DialogHeader>
        <AttachmentFilePicker {...filePicker} />
        {canAttachLocalPaths() ? (
          <div className="border-border space-y-3 border-t pt-4">
            <div>
              <label
                htmlFor="attach-local-path"
                className="text-sm font-medium"
              >
                {t.task.attachByPath}
              </label>
              <p
                id="attach-local-path-hint"
                className="text-muted-foreground mt-1 text-sm"
              >
                {t.task.attachByPathDescription}
              </p>
            </div>
            <textarea
              id="attach-local-path"
              aria-describedby="attach-local-path-hint"
              data-testid="attach-by-path-input"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={t.task.attachByPathPlaceholder}
              spellCheck={false}
              className="border-border bg-background focus:ring-ring w-full resize-none rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
            />
            {errors.length > 0 ? (
              <ul role="alert" className="text-destructive space-y-1 text-sm">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end">
              <Button
                onClick={() => void submit()}
                disabled={busy || !text.trim()}
              >
                {t.task.attachByPathSubmit}
              </Button>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            {t.common.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
