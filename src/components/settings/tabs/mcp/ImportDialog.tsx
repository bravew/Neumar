import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

export function ImportDialog({
  open,
  onOpenChange,
  importJson,
  onImportJsonChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  importJson: string;
  onImportJsonChange: (value: string) => void;
  onImport: () => void;
}) {
  const { t } = useLanguage();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[100] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-2xl focus:outline-none">
          <DialogPrimitive.Title className="text-foreground text-lg font-semibold">
            {t.settings.mcpImportTitle}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-muted-foreground mt-2 text-sm">
            {t.settings.mcpImportDesc}
          </DialogPrimitive.Description>

          <textarea
            value={importJson}
            onChange={(e) => onImportJsonChange(e.target.value)}
            placeholder={t.settings.mcpImportPlaceholder}
            className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus:ring-ring mt-4 h-64 w-full resize-none rounded-lg border p-3 font-mono text-sm focus:ring-2 focus:outline-none"
            aria-label={t.settings.mcpImportTitle}
          />

          <button
            onClick={onImport}
            disabled={!importJson.trim()}
            className="bg-foreground text-background hover:bg-foreground/90 mt-4 flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.settings.mcpImportButton}
          </button>

          <DialogPrimitive.Close
            className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-opacity focus:outline-none"
            aria-label="Close"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
