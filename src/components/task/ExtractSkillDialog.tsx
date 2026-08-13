import { useCallback, useEffect, useRef, useState } from 'react';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CheckCircle2, Loader2, X } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface ExtractSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  defaultName: string;
}

export function ExtractSkillDialog({
  open,
  onOpenChange,
  taskId,
  defaultName,
}: ExtractSkillDialogProps) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state when dialog opens; abort in-flight request when it closes
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setDescription('');
      setIsExtracting(false);
      setError(null);
      setIsSuccess(false);
      requestAnimationFrame(() => nameInputRef.current?.select());
    }
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [open, defaultName]);

  const handleExtract = useCallback(async () => {
    if (!name.trim()) return;

    // Abort any previous in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsExtracting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/files/extract-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          name: name.trim(),
          description: description.trim() || undefined,
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to extract skill');
        return;
      }

      setIsSuccess(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsExtracting(false);
    }
  }, [name, description, taskId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !isExtracting && name.trim()) {
        e.preventDefault();
        handleExtract();
      }
    },
    [handleExtract, isExtracting, name],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[100] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-2xl focus:outline-none">
          <DialogPrimitive.Title className="text-foreground text-lg font-semibold">
            {t.task.extractAsSkillTitle}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-muted-foreground mt-1 text-sm">
            {t.task.extractAsSkillDescription}
          </DialogPrimitive.Description>

          {isSuccess ? (
            <div className="mt-5 flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="text-primary size-10" />
              <p className="text-foreground text-sm font-medium">
                {t.task.skillCreated}
              </p>
              <p className="text-muted-foreground text-center text-xs">
                {t.task.skillCreatedMessage.replace('{name}', name)}
              </p>
              <button
                onClick={() => onOpenChange(false)}
                className="bg-foreground text-background hover:bg-foreground/90 mt-2 flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors"
              >
                {t.task.done}
              </button>
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                <div>
                  <label
                    htmlFor="skill-name"
                    className="text-foreground mb-1 block text-xs font-medium"
                  >
                    {t.task.skillName}
                  </label>
                  <input
                    id="skill-name"
                    ref={nameInputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t.task.skillName}
                    className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="skill-description"
                    className="text-foreground mb-1 block text-xs font-medium"
                  >
                    {t.task.skillDescriptionLabel}
                  </label>
                  <textarea
                    id="skill-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t.task.skillDescriptionPlaceholder}
                    rows={2}
                    className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus:ring-ring w-full resize-none rounded-lg border p-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>

              {error && (
                <p className="text-destructive mt-3 text-xs">{error}</p>
              )}

              <button
                onClick={handleExtract}
                disabled={!name.trim() || isExtracting}
                className="bg-foreground text-background hover:bg-foreground/90 mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t.task.extracting}
                  </>
                ) : (
                  t.task.extractButton
                )}
              </button>
            </>
          )}

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
