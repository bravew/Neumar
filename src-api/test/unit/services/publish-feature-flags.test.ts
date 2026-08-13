import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsStore = new Map<string, string>();

vi.mock('@/shared/db/operations', () => ({
  getSetting: (key: string) => settingsStore.get(key) ?? null,
}));

describe('publish feature flags', () => {
  beforeEach(() => {
    settingsStore.clear();
    delete process.env.PUBLISH_PIPELINE_ENABLED;
  });

  it('enables the pipeline from synced publish settings', async () => {
    settingsStore.set('publish', JSON.stringify({ enabled: true }));
    const { isPublishPipelineEnabled } =
      await import('@/shared/services/publish/feature-flags');

    expect(isPublishPipelineEnabled()).toBe(true);
  });

  it('lets explicit rollout flags override publish settings', async () => {
    settingsStore.set('publish', JSON.stringify({ enabled: true }));
    settingsStore.set('PUBLISH_PIPELINE_ENABLED', 'false');
    const { isPublishPipelineEnabled } =
      await import('@/shared/services/publish/feature-flags');

    expect(isPublishPipelineEnabled()).toBe(false);
  });
});
