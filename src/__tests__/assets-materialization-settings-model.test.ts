import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MATERIALIZATION_FORM,
  buildMaterializationForm,
  buildMaterializationSettingsPayload,
} from '@/components/settings/components/assetsMaterializationSettingsModel';

describe('assets materialization settings model', () => {
  it('loads proxy thresholds into editable field units', () => {
    const form = buildMaterializationForm({
      'assets.proxy_thresholds_json': JSON.stringify({
        minPixelCount: 12_345_678,
        minDurationSeconds: 900,
        minBytes: 734_003_200,
      }),
    });

    expect(form.proxyMinMegapixels).toBe('12.35');
    expect(form.proxyMinDurationMin).toBe('15');
    expect(form.proxyMinSizeMb).toBe('700');
  });

  it('serializes budgets and proxy thresholds for the settings API', () => {
    const payload = Object.fromEntries(
      buildMaterializationSettingsPayload({
        ...DEFAULT_MATERIALIZATION_FORM,
        sessionBudgetGb: '2.5',
        projectBudgetGb: '11',
        cacheMaxGb: '17',
        cacheTtlDays: '45.8',
        rangeMinMb: '64',
        proxyMinMegapixels: '9.5',
        proxyMinDurationMin: '12',
        proxyMinSizeMb: '640',
      }),
    );

    expect(payload['assets.materialize_session_budget_bytes']).toBe(
      '2684354560',
    );
    expect(payload['assets.materialize_project_budget_bytes']).toBe(
      '11811160064',
    );
    expect(payload['assets.cache_max_bytes']).toBe('18253611008');
    expect(payload['assets.cache_ttl_days']).toBe('46');
    expect(payload['assets.range_download_min_bytes']).toBe('67108864');
    expect(JSON.parse(payload['assets.proxy_thresholds_json'])).toEqual({
      minPixelCount: 9_500_000,
      minDurationSeconds: 720,
      minBytes: 671_088_640,
    });
  });
});
