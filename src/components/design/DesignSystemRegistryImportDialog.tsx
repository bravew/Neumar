import { type FormEvent, useState } from 'react';

import { Import } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { importShadcnRegistryDesignSystem } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

export function DesignSystemRegistryImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (system: DesignSystemRecord) => void;
}) {
  const { t } = useLanguage();
  const [url, setUrl] = useState('');
  const [item, setItem] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setUrl('');
    setItem('');
    setError('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) reset();
    onOpenChange(nextOpen);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedItem = item.trim();
    if (!trimmedUrl) {
      setError(t.design.importShadcnRegistryUrlRequired);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const { designSystem } = await importShadcnRegistryDesignSystem({
        url: trimmedUrl,
        item: trimmedItem || undefined,
      });
      reset();
      onImported(designSystem);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <DialogHeader>
            <DialogTitle>{t.design.importShadcnRegistryTitle}</DialogTitle>
            <DialogDescription>
              {t.design.importShadcnRegistryDescription}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm" htmlFor="shadcn-registry-url">
            <span>{t.design.importShadcnRegistryUrl}</span>
            <input
              id="shadcn-registry-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'shadcn-registry-error' : undefined}
              className="border-input bg-background focus:ring-ring/40 h-10 rounded-md border px-3 outline-none focus:ring-2"
              placeholder={t.design.importShadcnRegistryUrlPlaceholder}
              data-testid="design-system-shadcn-url"
            />
          </label>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="shadcn-registry-item"
          >
            <span>{t.design.importShadcnRegistryItem}</span>
            <input
              id="shadcn-registry-item"
              value={item}
              onChange={(event) => setItem(event.target.value)}
              className="border-input bg-background focus:ring-ring/40 h-10 rounded-md border px-3 outline-none focus:ring-2"
              placeholder={t.design.importShadcnRegistryItemPlaceholder}
              data-testid="design-system-shadcn-item"
            />
          </label>
          {error && (
            <p
              id="shadcn-registry-error"
              className="text-destructive text-sm"
              role="alert"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="design-system-shadcn-submit"
            >
              <Import className="size-4" />
              {submitting
                ? t.design.importing
                : t.design.importShadcnRegistrySubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
