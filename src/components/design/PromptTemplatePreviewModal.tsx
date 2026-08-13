import { useEffect, useMemo, useState } from 'react';

import { Copy, ExternalLink, Image, Play, Sparkles } from 'lucide-react';

import { aspectRatioStyle } from '@/components/design/promptTemplateAspect';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPromptTemplateDetail } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { PromptTemplateSnapshot } from '@/shared/types/design-mode';

export function PromptTemplatePreviewModal({
  template,
  creating,
  error,
  onCreate,
  onOpenChange,
}: {
  template: PromptTemplateSnapshot | null;
  creating: boolean;
  error?: string;
  onCreate: (template: PromptTemplateSnapshot) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<PromptTemplateSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const displayTemplate = detail ?? template;
  const prompt = displayTemplate?.prompt ?? '';
  const sourceLabel = useMemo(() => {
    const source = displayTemplate?.source;
    if (!source) return '';
    return [source.author, source.repo, source.license]
      .filter(Boolean)
      .join(' · ');
  }, [displayTemplate]);

  useEffect(() => {
    if (!template) {
      setDetail(null);
      setLoadError('');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setLoadError('');
    getPromptTemplateDetail(template.surface, template.id)
      .then(({ template: fetched }) => {
        if (!cancelled) setDetail(fetched ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [template]);

  const copyPrompt = () => {
    if (!prompt) return;
    navigator.clipboard?.writeText(prompt).catch(() => {});
  };

  return (
    <Dialog open={Boolean(template)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-4xl">
        {displayTemplate && (
          <>
            <DialogHeader>
              <DialogTitle>{displayTemplate.title}</DialogTitle>
              <DialogDescription>
                {displayTemplate.summary || t.design.promptTemplatePreview}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
              <div className="space-y-3">
                <TemplateMedia template={displayTemplate} />
                <div className="flex flex-wrap gap-2 text-xs">
                  {displayTemplate.category && (
                    <span className="bg-muted rounded px-2 py-1">
                      {displayTemplate.category}
                    </span>
                  )}
                  {displayTemplate.model && (
                    <span className="bg-muted rounded px-2 py-1">
                      {displayTemplate.model}
                    </span>
                  )}
                  {displayTemplate.aspect && (
                    <span className="bg-muted rounded px-2 py-1">
                      {displayTemplate.aspect}
                    </span>
                  )}
                  {(displayTemplate.tags ?? []).slice(0, 6).map((tag) => (
                    <span key={tag} className="bg-muted rounded px-2 py-1">
                      {tag}
                    </span>
                  ))}
                </div>
                {sourceLabel && (
                  <p className="text-muted-foreground text-xs">
                    {t.design.source}: {sourceLabel}
                  </p>
                )}
              </div>
              <section className="min-h-0 rounded-md border">
                <div className="border-b px-3 py-2 text-sm font-medium">
                  {t.design.prompt}
                </div>
                <pre className="text-muted-foreground max-h-[45vh] overflow-auto p-3 text-sm whitespace-pre-wrap">
                  {loading
                    ? t.design.loadingPromptTemplate
                    : loadError || prompt || t.design.noPromptAvailable}
                </pre>
              </section>
            </div>
            {(error || loadError) && (
              <p className="text-destructive text-sm">{error || loadError}</p>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              {displayTemplate.source?.url && (
                <Button
                  type="button"
                  variant="ghost"
                  asChild
                  data-testid="prompt-template-view-original"
                >
                  <a
                    href={displayTemplate.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="size-4" />
                    {t.design.viewOriginal}
                  </a>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={copyPrompt}
                disabled={!prompt}
              >
                <Copy className="size-4" />
                {t.design.copy}
              </Button>
              <Button
                type="button"
                onClick={() => onCreate(displayTemplate)}
                disabled={creating || !prompt}
              >
                <Sparkles className="size-4" />
                {creating ? t.design.creating : t.design.createFromTemplate}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateMedia({ template }: { template: PromptTemplateSnapshot }) {
  const style = aspectRatioStyle(template);
  if (template.previewVideoUrl) {
    return (
      <video
        className="bg-muted w-full rounded-md border object-contain"
        style={style}
        src={template.previewVideoUrl}
        poster={template.previewImageUrl}
        controls
        preload="metadata"
        playsInline
      />
    );
  }

  if (template.previewImageUrl) {
    return (
      <img
        src={template.previewImageUrl}
        alt={template.title}
        className="bg-muted w-full rounded-md border object-contain"
        style={style}
      />
    );
  }

  const Icon = template.surface === 'video' ? Play : Image;
  return (
    <div
      className="bg-muted text-muted-foreground flex w-full items-center justify-center rounded-md border"
      style={style}
    >
      <Icon className="size-10" />
    </div>
  );
}
