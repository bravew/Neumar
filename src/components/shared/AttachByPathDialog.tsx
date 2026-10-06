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
import { normalizePathInput } from '@/shared/lib/local-path';
import { useLanguage } from '@/shared/providers/language-provider';

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
}

export function AttachByPathDialog({
  open,
  onOpenChange,
  onAttach,
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.task.attachByPathTitle}</DialogTitle>
          <DialogDescription>
            {t.task.attachByPathDescription}
          </DialogDescription>
        </DialogHeader>
        <textarea
          data-testid="attach-by-path-input"
          autoFocus
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
        <DialogFooter className="flex-row justify-end gap-2 sm:gap-2">
          <Button onClick={() => void submit()} disabled={busy || !text.trim()}>
            {t.task.attachByPathSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
