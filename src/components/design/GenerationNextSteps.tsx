import { useEffect, useState } from 'react';

import { Check, Copy, Share2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';

const GENERATED_ARTIFACT_PREFIXES = [
  'artifacts/',
  'assets/generated/',
  'exports/',
] as const;

function isGenerationNextStepPath(path: string | null): path is string {
  return Boolean(
    path &&
    GENERATED_ARTIFACT_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
}

export function GenerationNextSteps({
  path,
  onExport,
  onSendToChat,
}: {
  path: string | null;
  onExport: () => void;
  onSendToChat?: (prompt: string) => void;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copyPath = async () => {
    if (!path) return;
    try {
      await navigator.clipboard?.writeText(path);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  if (!isGenerationNextStepPath(path)) return null;
  const labels = t.design;
  const iterate = onSendToChat
    ? () => onSendToChat(labels.nextStepsIteratePrompt.replace('{path}', path))
    : undefined;

  return (
    <section
      aria-label={labels.nextStepsRegion}
      className="border-border bg-muted/25 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
    >
      <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
        {labels.nextStepsReady.replace('{path}', path)}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {iterate && (
          <Button type="button" variant="ghost" size="sm" onClick={iterate}>
            <Sparkles className="size-4" />
            {labels.nextStepsIterate}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onExport}>
          <Share2 className="size-4" />
          {labels.nextStepsExport}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={copyPath}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          <span aria-live="polite">
            {copied ? labels.nextStepsCopiedPath : labels.nextStepsCopyPath}
          </span>
        </Button>
      </div>
    </section>
  );
}
