import type { PluginManifestLike } from '@/shared/hooks/usePlugins';
import { useLanguage } from '@/shared/providers/language-provider';

type PluginConfigField = NonNullable<
  NonNullable<
    NonNullable<PluginManifestLike['metadata']>['neuma']
  >['configSchema']
>[number];

export function PluginConfigSchemaPreview({
  fields,
}: {
  fields: PluginConfigField[];
}) {
  const { t } = useLanguage();
  const ordered = [...fields].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key),
  );

  return (
    <div>
      <p className="text-foreground mb-2 text-xs font-medium">
        {t.plugins.details.configuration}
      </p>
      <div className="space-y-2">
        {ordered.map((field) => (
          <div
            key={field.key}
            className="border-border bg-muted/30 rounded-md border p-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-foreground text-xs font-medium">
                  {field.label ?? field.key}
                </p>
                <p className="text-muted-foreground font-mono text-[11px]">
                  {field.key} · {field.type}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {field.sensitive ? (
                  <span className="bg-background text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]">
                    {t.plugins.details.sensitive}
                  </span>
                ) : null}
                {field.advanced ? (
                  <span className="bg-background text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]">
                    {t.plugins.details.advanced}
                  </span>
                ) : null}
              </div>
            </div>
            {field.help ? (
              <p className="text-muted-foreground mt-1 text-xs">{field.help}</p>
            ) : null}
            <ConfigFieldControl field={field} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigFieldControl({ field }: { field: PluginConfigField }) {
  const commonClass =
    'border-input bg-background text-muted-foreground mt-2 w-full rounded-md border px-2 py-1.5 text-xs';
  const value =
    typeof field.default === 'string' ||
    typeof field.default === 'number' ||
    typeof field.default === 'boolean'
      ? String(field.default)
      : '';

  if (field.type === 'boolean') {
    return (
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={field.default === true}
          readOnly
          className="accent-primary size-4 rounded"
        />
        <span className="text-muted-foreground">
          {field.label ?? field.key}
        </span>
      </label>
    );
  }

  const ariaLabel = field.label ?? field.key;

  if (field.type === 'enum') {
    return (
      <select
        className={commonClass}
        value={value}
        disabled
        aria-label={ariaLabel}
      >
        {field.options?.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={field.type === 'secret' ? 'password' : 'text'}
      value={value}
      readOnly
      className={commonClass}
      placeholder={ariaLabel}
      aria-label={ariaLabel}
    />
  );
}
