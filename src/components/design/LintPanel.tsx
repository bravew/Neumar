import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignLintFinding } from '@/shared/types/design-mode';

export function LintPanel({ findings }: { findings: DesignLintFinding[] }) {
  const { t } = useLanguage();
  if (findings.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border p-3">
      <h3 className="text-sm font-medium">
        {t.design.lintIssues.replace('{count}', String(findings.length))}
      </h3>
      <ol className="mt-2 space-y-2 text-xs">
        {findings.map((finding, index) => (
          <li key={`${finding.id}-${index}`} className="rounded border p-2">
            <div className="flex items-center gap-2">
              <span
                className={
                  finding.severity === 'p0'
                    ? 'text-destructive font-medium'
                    : 'font-medium text-amber-700 dark:text-amber-300'
                }
              >
                {finding.severity === 'p0' ? t.design.lintP0 : t.design.lintP1}
              </span>
              <span className="font-medium">{finding.id}</span>
            </div>
            <p className="text-muted-foreground mt-1">{finding.message}</p>
            {finding.suggestion && (
              <p className="text-muted-foreground mt-1">{finding.suggestion}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
