import { useLanguage } from '@/shared/providers/language-provider';
import { useVideoFlags } from '@/shared/video/useVideoFlags';

import { HtmlTemplateSection } from './HtmlTemplateSection';
import { HtmlVideoFrames } from './HtmlVideoFrames';

// Slice K — the in-editor HTML-video surface that makes the html-video flow
// user-reachable: engine + template picker, schema-driven variables, live frame
// preview, and the agent's multi-frame content-graph. Gated by the kill-switch
// flags (on by default); renders nothing when an operator disables them.

export function HtmlVideoPanel({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const { flags, loading } = useVideoFlags();

  if (loading) return null;
  const enabled =
    flags['video.templateGallery'] !== false &&
    flags['video.contentGraph'] !== false;
  if (!enabled) return null;

  return (
    <section
      aria-label={t.video.htmlGallery.panelTitle}
      className="border-border bg-background space-y-4 rounded-md border p-3"
    >
      <h2 className="text-foreground text-sm font-semibold">
        {t.video.htmlGallery.panelTitle}
      </h2>
      <HtmlTemplateSection projectId={projectId} />
      <HtmlVideoFrames projectId={projectId} />
    </section>
  );
}
