import { Loader2 } from 'lucide-react';

import { HtmlSandbox } from '@/components/artifacts/live/HtmlSandbox';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import {
  useDesignSystemComponentsHtml,
  useDesignSystemShowcaseHtml,
} from './design-system-html';
import { DesignSystemShowcase } from './DesignSystemPreview';

/**
 * Modal "Showcase" pane (Open Design parity). Renders the *generated* showcase
 * — the uniform "The system that makes X feel like X" marketing page
 * synthesized server-side from the system's DESIGN.md tokens, exactly as Open
 * Design's grid and modal do — in a sandboxed full-document iframe. Falls back
 * to the synthetic CSS-themed {@link DesignSystemShowcase} only if the
 * generated page can't be fetched.
 */
export function DesignSystemShowcaseView({
  system,
  testId,
}: {
  system: DesignSystemRecord;
  testId?: string;
}) {
  const { html, loading } = useDesignSystemShowcaseHtml(system.id);

  if (html) {
    return (
      <SandboxedHtml
        html={html}
        identity={`ds-showcase:${system.id}`}
        title={system.title}
        testId={testId}
      />
    );
  }
  if (loading) return <ShowcaseLoading testId={testId} />;
  // Generation failed — synthetic CSS-themed hero.
  return <DesignSystemShowcase system={system} testId={testId} />;
}

/**
 * Modal "Reference" pane. Renders the system's bundled bespoke
 * `components.html` — the hand-authored "reference components" fixture that
 * exercises every token (distinct from the generated marketing Showcase). The
 * summary-mode list omits `componentsHtml`, so this lazily fetches the full
 * record on open.
 */
export function DesignSystemReferenceView({
  system,
  testId,
}: {
  system: DesignSystemRecord;
  testId?: string;
}) {
  const { t } = useLanguage();
  const { html, loading } = useDesignSystemComponentsHtml(system);

  if (html) {
    return (
      <SandboxedHtml
        html={html}
        identity={`ds-reference:${system.id}`}
        title={system.title}
        testId={testId}
      />
    );
  }
  if (loading) return <ShowcaseLoading testId={testId} />;
  return (
    <div
      className="text-muted-foreground flex min-h-full items-center justify-center p-10 text-center text-sm"
      data-testid={testId}
    >
      {t.design.noReferenceFixture}
    </div>
  );
}

function SandboxedHtml({
  html,
  identity,
  title,
  testId,
}: {
  html: string;
  identity: string;
  title: string;
  testId?: string;
}) {
  return (
    <div className="min-h-full bg-white" data-testid={testId}>
      <HtmlSandbox
        html={html}
        identity={identity}
        title={title}
        renderFullDocument
      />
    </div>
  );
}

function ShowcaseLoading({ testId }: { testId?: string }) {
  return (
    <div
      className="text-muted-foreground flex min-h-full items-center justify-center gap-2 p-10 text-sm"
      data-testid={testId}
    >
      <Loader2 className="size-4 animate-spin" />
    </div>
  );
}
