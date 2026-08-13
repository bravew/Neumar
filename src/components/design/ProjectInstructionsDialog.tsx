import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';

const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 5000;

export function ProjectInstructionsDialog({
  open,
  value,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  value: string;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: string) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const save = () => {
    onSave(draft.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.design.customInstructionsTitle}</DialogTitle>
          <DialogDescription>
            {t.design.customInstructionsDescription}
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">
            {t.design.customInstructionsLabel}
          </span>
          <textarea
            value={draft}
            maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t.design.customInstructionsPlaceholder}
            className="border-input bg-background min-h-44 rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <p className="text-muted-foreground text-xs">
          {draft.length}/{CUSTOM_INSTRUCTIONS_MAX_LENGTH}
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t.common.cancel}
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
