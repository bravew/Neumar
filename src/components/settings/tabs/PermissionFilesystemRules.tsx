import { ShieldX } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

export type FilesystemOperation = 'read' | 'write' | 'ls' | 'glob' | 'grep';

export interface FilesystemRule {
  pattern: string;
  effect: 'allow' | 'deny';
  ops?: FilesystemOperation[];
}

export function FilesystemRuleSection({ rules }: { rules: FilesystemRule[] }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldX className="size-4 text-red-500" />
        <h3 className="text-sm font-medium">{t.settings.filesystemRules}</h3>
      </div>
      <p className="text-muted-foreground text-xs">
        {t.settings.filesystemRulesDescription}
      </p>

      {rules.length === 0 ? (
        <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-xs">
          {t.settings.filesystemRulesEmpty}
        </p>
      ) : (
        <div className="space-y-1">
          {rules.map((rule, index) => (
            <div
              key={`${rule.pattern}-${index}`}
              className="bg-muted/50 flex items-center justify-between gap-2 rounded-md px-3 py-1.5"
            >
              <code className="text-xs">{rule.pattern}</code>
              <span className="text-muted-foreground text-xs">
                {rule.effect}
                {rule.ops?.length ? ` · ${rule.ops.join(', ')}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
