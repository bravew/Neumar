import { useState } from 'react';

import type { DEFAULT_DESIGN_MODE_SETTINGS } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

type DesignModeConfig = typeof DEFAULT_DESIGN_MODE_SETTINGS;

export function DesignModeMediaSettings({
  config,
  onChange,
}: {
  config: DesignModeConfig;
  onChange: (patch: Partial<DesignModeConfig>) => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(() =>
    JSON.stringify(config.media.aliases, null, 2),
  );
  const [error, setError] = useState('');

  const persist = () => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(t.settings.designModeMediaAliasesObjectError);
      }
      const aliases: Record<string, string> = {};
      for (const [from, to] of Object.entries(parsed)) {
        if (typeof to !== 'string') {
          throw new Error(t.settings.designModeMediaAliasesValueError);
        }
        if (from.trim() && to.trim()) aliases[from] = to;
      }
      setError('');
      onChange({ media: { ...config.media, aliases } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">
          {t.settings.designModeMediaHeading}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.settings.designModeMediaDescription}
        </p>
      </div>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">{t.settings.designModeMediaAliases}</span>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={persist}
          spellCheck={false}
          className="border-input bg-background min-h-28 rounded-md border px-3 py-2 font-mono text-xs"
        />
      </label>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t.settings.designModeMediaAliasesDescription}
        </p>
      )}
    </section>
  );
}
