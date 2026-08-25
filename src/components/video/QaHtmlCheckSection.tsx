import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import { useHtmlCompositionCheck } from '@/shared/video/useHtmlCompositionCheck';

const MAX_LISTED_FINDINGS = 5;

interface QaHtmlCheckSectionProps {
  projectId: string;
  compositionDir?: string;
}

/**
 * HyperFrames `check --json` in the QA panel (P2-1): lint + runtime + layout
 * + motion + WCAG AA contrast from one browser session. Findings are a
 * result, not a failure — a non-clean report renders normally.
 */
export function QaHtmlCheckSection({
  projectId,
  compositionDir = 'hyperframes',
}: QaHtmlCheckSectionProps) {
  const { t } = useLanguage();
  const h = t.video.editor.qa.htmlCheck;
  const { result, running, error, run } = useHtmlCompositionCheck(projectId);

  return (
    <div className="border-border mt-2 space-y-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-foreground text-xs font-medium">{h.title}</span>
        <button
          type="button"
          onClick={() => run(compositionDir)}
          disabled={running}
          className="border-border text-foreground hover:bg-muted inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] disabled:opacity-60"
          data-testid="qa-html-check-run"
        >
          {running ? <Loader2 className="size-3 animate-spin" /> : null}
          {running ? h.running : h.run}
        </button>
        {result ? (
          <span
            className={
              result.summary.ok
                ? 'text-muted-foreground flex items-center gap-1 text-[11px]'
                : 'text-destructive flex items-center gap-1 text-[11px]'
            }
          >
            {result.summary.ok ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            {result.summary.ok
              ? h.clean
              : h.counts
                  .replace('{errors}', String(result.summary.errorCount))
                  .replace('{warnings}', String(result.summary.warningCount))}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-destructive text-[11px]">
          {h.error.replace('{error}', error)}
        </p>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {result.summary.passes.map((pass) => (
              <span
                key={pass.key}
                className="border-border bg-muted/40 rounded border px-1.5 py-0.5 text-[11px]"
                title={pass.enabled ? undefined : h.passDisabled}
              >
                <span className="text-foreground">
                  {h.pass[pass.key as keyof typeof h.pass] ?? pass.key}
                </span>{' '}
                <span
                  className={
                    pass.ok ? 'text-muted-foreground' : 'text-destructive'
                  }
                >
                  {pass.enabled
                    ? `${pass.errorCount}/${pass.warningCount}`
                    : h.passDisabled}
                </span>
              </span>
            ))}
          </div>
          {result.findings.length > 0 ? (
            <ul className="space-y-1">
              {result.findings
                .slice(0, MAX_LISTED_FINDINGS)
                .map((finding, index) => (
                  <li
                    key={`${finding.code}-${index}`}
                    className="text-muted-foreground text-[11px]"
                  >
                    <span className="text-foreground font-medium">
                      {finding.code}
                    </span>{' '}
                    {finding.message}
                  </li>
                ))}
              {result.findings.length > MAX_LISTED_FINDINGS ? (
                <li className="text-muted-foreground text-[11px]">
                  {h.more.replace(
                    '{count}',
                    String(result.findings.length - MAX_LISTED_FINDINGS),
                  )}
                </li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
