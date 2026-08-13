import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { AlertCircle, CheckCircle2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  usePluginConfig,
  type PluginConfigPatchValue,
  type PluginConfigPrimitive,
  type PublicPluginConfigValue,
} from '@/shared/hooks/usePlugins';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface PluginConfigEditorProps {
  pluginId: string;
  active: boolean;
}

type DraftValue = string | boolean;

export function PluginConfigEditor({
  pluginId,
  active,
}: PluginConfigEditorProps) {
  const { t } = useLanguage();
  const { config, loading, saving, error, saveConfig } = usePluginConfig(
    pluginId,
    active,
  );
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [saved, setSaved] = useState(false);

  const fields = useMemo(
    () =>
      [...(config?.values ?? [])].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key),
      ),
    [config?.values],
  );

  useEffect(() => {
    setDraft(buildDraft(fields));
  }, [fields]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const values = buildPatch(fields, draft);
    try {
      await saveConfig(values);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-foreground text-xs font-medium">
          {t.plugins.details.configuration}
        </p>
        <Button size="sm" type="submit" disabled={loading || saving}>
          <Save className="size-3.5" />
          {saving ? t.plugins.config.saving : t.plugins.config.save}
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-xs">
          {t.plugins.config.loading}
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive mb-2 flex items-center gap-1.5 text-xs">
          <AlertCircle className="size-3.5 shrink-0" />
          {t.plugins.config.saveFailed}: {error}
        </p>
      ) : null}

      {saved ? (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckCircle2 className="size-3.5 shrink-0" />
          {t.plugins.config.saved}
        </p>
      ) : null}

      <div className="space-y-2">
        {fields.map((field) => (
          <ConfigField
            key={field.key}
            field={field}
            value={draft[field.key]}
            disabled={loading || saving}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, [field.key]: value }))
            }
          />
        ))}
      </div>
    </form>
  );
}

function ConfigField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PublicPluginConfigValue;
  value: DraftValue | undefined;
  disabled: boolean;
  onChange: (value: DraftValue) => void;
}) {
  const { t } = useLanguage();
  const label = field.label ?? field.key;
  const valueText = typeof value === 'string' ? value : '';
  const commonClass =
    'border-input bg-background text-foreground mt-2 w-full rounded-md border px-2 py-1.5 text-xs outline-none focus:border-ring focus:ring-ring/50 focus:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="border-border bg-muted/30 rounded-md border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <label htmlFor={fieldInputId(field)} className="text-xs font-medium">
            {label}
          </label>
          <p className="text-muted-foreground font-mono text-[11px]">
            {field.key} · {field.type}
          </p>
        </div>
        <FieldBadges field={field} />
      </div>

      {field.help ? (
        <p className="text-muted-foreground mt-1 text-xs">{field.help}</p>
      ) : null}

      {field.type === 'boolean' ? (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            id={fieldInputId(field)}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.checked)}
            className="accent-primary size-4 rounded"
          />
          <span className="text-muted-foreground">{label}</span>
        </label>
      ) : field.type === 'enum' && field.options?.length ? (
        <select
          id={fieldInputId(field)}
          className={commonClass}
          value={valueText}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {!field.required ? <option value="" /> : null}
          {field.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={fieldInputId(field)}
          type={
            field.type === 'secret'
              ? 'password'
              : field.type === 'number'
                ? 'number'
                : 'text'
          }
          value={valueText}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={commonClass}
          placeholder={
            field.type === 'secret' ? t.plugins.config.secretPlaceholder : label
          }
        />
      )}

      {field.type === 'secret' && field.hasSecret ? (
        <p className="text-muted-foreground mt-1 text-[11px]">
          {t.plugins.config.configuredSecret}
          {field.secretHint ? ` (${field.secretHint})` : null}
        </p>
      ) : null}
    </div>
  );
}

function FieldBadges({ field }: { field: PublicPluginConfigValue }) {
  const { t } = useLanguage();
  const badges = [
    field.required ? t.plugins.config.required : null,
    field.sensitive ? t.plugins.details.sensitive : null,
    field.advanced ? t.plugins.details.advanced : null,
    field.hasValue ? t.plugins.config.currentValue : null,
  ].filter((badge): badge is string => Boolean(badge));

  if (badges.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {badges.map((badge) => (
        <span
          key={badge}
          className={cn(
            'bg-background text-muted-foreground rounded border px-1.5 py-0.5 text-[10px]',
            badge === t.plugins.config.required &&
              'border-primary/30 text-primary',
          )}
        >
          {badge}
        </span>
      ))}
    </div>
  );
}

function buildDraft(fields: PublicPluginConfigValue[]) {
  return Object.fromEntries(
    fields.map((field) => [field.key, fieldToDraftValue(field)]),
  ) as Record<string, DraftValue>;
}

function fieldToDraftValue(field: PublicPluginConfigValue): DraftValue {
  if (field.type === 'secret') return '';
  if (field.type === 'boolean') {
    return getBooleanValue(field.value, field.defaultValue);
  }
  const value = field.value ?? field.defaultValue ?? firstOptionValue(field);
  return value === undefined ? '' : String(value);
}

function firstOptionValue(
  field: PublicPluginConfigValue,
): PluginConfigPrimitive | undefined {
  return field.type === 'enum' && field.required
    ? field.options?.[0]?.value
    : undefined;
}

function getBooleanValue(
  value: PluginConfigPrimitive | undefined,
  defaultValue: PluginConfigPrimitive | undefined,
) {
  if (typeof value === 'boolean') return value;
  if (typeof defaultValue === 'boolean') return defaultValue;
  return false;
}

function buildPatch(
  fields: PublicPluginConfigValue[],
  draft: Record<string, DraftValue>,
) {
  const patch: Record<string, PluginConfigPatchValue> = {};
  for (const field of fields) {
    const value = draft[field.key];
    if (field.type === 'secret') {
      if (typeof value === 'string' && value.length > 0) {
        patch[field.key] = value;
      }
      continue;
    }
    if (field.type === 'boolean') {
      patch[field.key] = value === true;
      continue;
    }
    if (field.type === 'number') {
      const text = typeof value === 'string' ? value.trim() : '';
      patch[field.key] = text.length > 0 ? Number(text) : null;
      continue;
    }
    const text = typeof value === 'string' ? value : '';
    patch[field.key] = text.length > 0 ? text : null;
  }
  return patch;
}

function fieldInputId(field: PublicPluginConfigValue) {
  return `plugin-config-${field.key}`;
}
