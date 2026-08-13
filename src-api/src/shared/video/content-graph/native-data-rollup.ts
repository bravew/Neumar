export interface DataRollupItem {
  label: string;
  value: number;
  description?: string;
  color?: string;
}

const DEFAULT_TITLE = 'Data rollup';
const DEFAULT_UNIT = '';

export function normalizeDataRollupVariables(
  variables: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const source = variables ?? {};
  const items =
    toDataRollupItems(source.items) ??
    toDataRollupItems(source.data) ??
    toDataRollupItems(source) ??
    [];

  return {
    ...source,
    title:
      asNonEmptyString(source.title) ??
      asNonEmptyString(source.label) ??
      DEFAULT_TITLE,
    subtitle: asNonEmptyString(source.subtitle),
    unit: asNonEmptyString(source.unit) ?? DEFAULT_UNIT,
    items: items.length > 0 ? items : fallbackItems(source),
  };
}

function toDataRollupItems(value: unknown): DataRollupItem[] | undefined {
  if (Array.isArray(value)) {
    const items = value.flatMap((entry, index) =>
      itemFromUnknown(entry, index),
    );
    return items.length > 0 ? items : undefined;
  }
  if (!isRecord(value)) return undefined;

  const nested =
    toDataRollupItems(value.items) ?? toDataRollupItems(value.data);
  if (nested) return nested;

  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const numeric = toFiniteNumber(entry);
    return numeric === undefined
      ? []
      : [{ label: humaniseKey(key), value: numeric }];
  });
  return entries.length > 0 ? entries : undefined;
}

function itemFromUnknown(value: unknown, index: number): DataRollupItem[] {
  if (isRecord(value)) {
    const numeric = toFiniteNumber(value.value);
    if (numeric === undefined) return [];
    const item: DataRollupItem = {
      label:
        asNonEmptyString(value.label) ??
        asNonEmptyString(value.name) ??
        `Item ${index + 1}`,
      value: numeric,
    };
    const description = asNonEmptyString(value.description);
    const color = asNonEmptyString(value.color);
    if (description) item.description = description;
    if (color) item.color = color;
    return [item];
  }
  const numeric = toFiniteNumber(value);
  return numeric === undefined
    ? []
    : [{ label: `Item ${index + 1}`, value: numeric }];
}

function fallbackItems(source: Record<string, unknown>): DataRollupItem[] {
  const numeric = Object.entries(source).flatMap(([key, value]) => {
    const numberValue = toFiniteNumber(value);
    return numberValue === undefined
      ? []
      : [{ label: humaniseKey(key), value: numberValue }];
  });
  return numeric.length > 0 ? numeric : [{ label: 'Value', value: 0 }];
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function humaniseKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
