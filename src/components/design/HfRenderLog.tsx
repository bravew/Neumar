import { useLanguage } from '@/shared/providers/language-provider';

export function HfRenderLog({ lines }: { lines: string[] }) {
  const { t } = useLanguage();
  return (
    <pre className="bg-muted max-h-40 overflow-auto rounded-md p-3 text-xs">
      {lines.join('\n') || t.design.noRenderLog}
    </pre>
  );
}
