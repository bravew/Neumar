export interface MaterializationFormState {
  sessionBudgetGb: string;
  projectBudgetGb: string;
  cacheMaxGb: string;
  cacheTtlDays: string;
  rangeMinMb: string;
  proxyMinMegapixels: string;
  proxyMinDurationMin: string;
  proxyMinSizeMb: string;
}

export interface MaterializationFieldConfig {
  id: keyof MaterializationFormState;
  labelKey: string;
  descriptionKey: string;
  min: number;
  step: number;
  suffix: string;
  suffixKey?: string;
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export const DEFAULT_MATERIALIZATION_FORM: MaterializationFormState = {
  sessionBudgetGb: '5',
  projectBudgetGb: '20',
  cacheMaxGb: '50',
  cacheTtlDays: '90',
  rangeMinMb: '32',
  proxyMinMegapixels: '8.29',
  proxyMinDurationMin: '10',
  proxyMinSizeMb: '500',
};

export const MATERIALIZATION_FIELD_CONFIG: MaterializationFieldConfig[] = [
  {
    id: 'sessionBudgetGb',
    labelKey: 'assetsMaterializeSessionBudget',
    descriptionKey: 'assetsMaterializeSessionBudgetDescription',
    min: 0,
    step: 1,
    suffix: 'GB',
  },
  {
    id: 'projectBudgetGb',
    labelKey: 'assetsMaterializeProjectBudget',
    descriptionKey: 'assetsMaterializeProjectBudgetDescription',
    min: 0,
    step: 1,
    suffix: 'GB',
  },
  {
    id: 'cacheMaxGb',
    labelKey: 'assetsMaterializeCacheMax',
    descriptionKey: 'assetsMaterializeCacheMaxDescription',
    min: 0,
    step: 1,
    suffix: 'GB',
  },
  {
    id: 'cacheTtlDays',
    labelKey: 'assetsMaterializeCacheTtl',
    descriptionKey: 'assetsMaterializeCacheTtlDescription',
    min: 0,
    step: 1,
    suffix: '',
    suffixKey: 'assetsMaterializeDaysUnit',
  },
  {
    id: 'rangeMinMb',
    labelKey: 'assetsMaterializeRangeMin',
    descriptionKey: 'assetsMaterializeRangeMinDescription',
    min: 1,
    step: 1,
    suffix: 'MB',
  },
  {
    id: 'proxyMinMegapixels',
    labelKey: 'assetsMaterializeProxyMinPixels',
    descriptionKey: 'assetsMaterializeProxyMinPixelsDescription',
    min: 0,
    step: 0.01,
    suffix: 'MP',
  },
  {
    id: 'proxyMinDurationMin',
    labelKey: 'assetsMaterializeProxyMinDuration',
    descriptionKey: 'assetsMaterializeProxyMinDurationDescription',
    min: 0,
    step: 1,
    suffix: '',
    suffixKey: 'assetsMaterializeMinutesUnit',
  },
  {
    id: 'proxyMinSizeMb',
    labelKey: 'assetsMaterializeProxyMinSize',
    descriptionKey: 'assetsMaterializeProxyMinSizeDescription',
    min: 0,
    step: 1,
    suffix: 'MB',
  },
];

export function buildMaterializationForm(
  settings: Record<string, string>,
): MaterializationFormState {
  return {
    sessionBudgetGb: bytesSettingToUnit(
      settings.assets_materialize_session_budget_bytes ??
        settings['assets.materialize_session_budget_bytes'],
      DEFAULT_MATERIALIZATION_FORM.sessionBudgetGb,
      GB,
    ),
    projectBudgetGb: bytesSettingToUnit(
      settings.assets_materialize_project_budget_bytes ??
        settings['assets.materialize_project_budget_bytes'],
      DEFAULT_MATERIALIZATION_FORM.projectBudgetGb,
      GB,
    ),
    cacheMaxGb: bytesSettingToUnit(
      settings.assets_cache_max_bytes ?? settings['assets.cache_max_bytes'],
      DEFAULT_MATERIALIZATION_FORM.cacheMaxGb,
      GB,
    ),
    cacheTtlDays:
      settings['assets.cache_ttl_days'] ??
      DEFAULT_MATERIALIZATION_FORM.cacheTtlDays,
    rangeMinMb: bytesSettingToUnit(
      settings.assets_range_download_min_bytes ??
        settings['assets.range_download_min_bytes'],
      DEFAULT_MATERIALIZATION_FORM.rangeMinMb,
      MB,
    ),
    ...proxyThresholdForm(
      settings.assets_proxy_thresholds_json ??
        settings['assets.proxy_thresholds_json'],
    ),
  };
}

export function buildMaterializationSettingsPayload(
  form: MaterializationFormState,
): Array<[string, string]> {
  return [
    [
      'assets.materialize_session_budget_bytes',
      unitToBytes(form.sessionBudgetGb, GB),
    ],
    [
      'assets.materialize_project_budget_bytes',
      unitToBytes(form.projectBudgetGb, GB),
    ],
    ['assets.cache_max_bytes', unitToBytes(form.cacheMaxGb, GB)],
    ['assets.cache_ttl_days', normalizedNumber(form.cacheTtlDays)],
    ['assets.range_download_min_bytes', unitToBytes(form.rangeMinMb, MB)],
    [
      'assets.proxy_thresholds_json',
      JSON.stringify({
        minPixelCount: Math.round(
          (Number(form.proxyMinMegapixels) || 0) * 1_000_000,
        ),
        minDurationSeconds: Math.round(
          (Number(form.proxyMinDurationMin) || 0) * 60,
        ),
        minBytes: unitToBytesNumber(form.proxyMinSizeMb, MB),
      }),
    ],
  ];
}

export function scopeLabel(
  scope: string,
  labels: Record<string, string>,
): string {
  return (
    {
      video_project: labels.assetsMaterializeScopeVideo,
      design_project: labels.assetsMaterializeScopeDesign,
      task: labels.assetsMaterializeScopeTask,
    }[scope] ?? labels.assetsMaterializeScopeOther
  );
}

function bytesSettingToUnit(
  value: string | undefined,
  fallback: string,
  divisor: number,
): string {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return trimNumber(parsed / divisor);
}

function unitToBytes(value: string, multiplier: number): string {
  return String(unitToBytesNumber(value, multiplier));
}

function unitToBytesNumber(value: string, multiplier: number): number {
  const parsed = Math.max(0, Number(value) || 0);
  return Math.round(parsed * multiplier);
}

function normalizedNumber(value: string): string {
  return String(Math.max(0, Math.round(Number(value) || 0)));
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function proxyThresholdForm(
  raw: string | undefined,
): Pick<
  MaterializationFormState,
  'proxyMinMegapixels' | 'proxyMinDurationMin' | 'proxyMinSizeMb'
> {
  if (!raw) {
    return {
      proxyMinMegapixels: DEFAULT_MATERIALIZATION_FORM.proxyMinMegapixels,
      proxyMinDurationMin: DEFAULT_MATERIALIZATION_FORM.proxyMinDurationMin,
      proxyMinSizeMb: DEFAULT_MATERIALIZATION_FORM.proxyMinSizeMb,
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<{
      minPixelCount: number;
      minDurationSeconds: number;
      minBytes: number;
    }>;
    return {
      proxyMinMegapixels: trimNumber(
        finiteNumber(parsed.minPixelCount, 8_294_400) / 1_000_000,
      ),
      proxyMinDurationMin: trimNumber(
        finiteNumber(parsed.minDurationSeconds, 600) / 60,
      ),
      proxyMinSizeMb: trimNumber(
        finiteNumber(parsed.minBytes, 524_288_000) / MB,
      ),
    };
  } catch {
    return {
      proxyMinMegapixels: DEFAULT_MATERIALIZATION_FORM.proxyMinMegapixels,
      proxyMinDurationMin: DEFAULT_MATERIALIZATION_FORM.proxyMinDurationMin,
      proxyMinSizeMb: DEFAULT_MATERIALIZATION_FORM.proxyMinSizeMb,
    };
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
