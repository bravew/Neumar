import { Copy, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';

export function ResolvedPromptDrawer({
  system,
  user,
  onClose,
}: {
  system: string;
  user: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).catch(() => {});
  return (
    <aside
      className="border-border bg-card flex h-full w-96 shrink-0 flex-col border-l"
      data-testid="resolved-prompt-drawer"
    >
      <header className="border-border flex shrink-0 items-center justify-between gap-3 border-b p-4">
        <h2 className="text-sm font-semibold">{t.design.resolvedPrompt}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.design.close}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {[
          [t.design.systemPrompt, system],
          [t.design.userPrompt, user],
        ].map(([title, body]) => (
          <section key={title} className="mt-4 first:mt-0">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase">{title}</h3>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => copy(body)}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <pre className="bg-muted max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {body || t.design.notResolvedYet}
            </pre>
          </section>
        ))}
      </div>
    </aside>
  );
}
