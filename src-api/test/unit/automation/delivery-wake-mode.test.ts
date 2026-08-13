import { afterEach, describe, expect, it, vi } from 'vitest';

import { deliver } from '@/shared/automation/delivery';
import type { Automation, AutomationRun } from '@/shared/automation/types';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-1',
    name: 'Daily check',
    enabled: true,
    prompt: 'Check something',
    trigger: { type: 'manual' },
    agent: { usePlanning: false, autoApprove: true },
    delivery: { mode: 'none' },
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    runCount: 0,
    totalCost: 0,
    origin: 'ui',
    locale: 'en',
    overlapPolicy: 'skip',
    missedFirePolicy: 'skip',
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'automation-1',
    status: 'completed',
    triggeredBy: 'manual',
    queuedAt: '2026-05-18T00:00:00.000Z',
    result: 'All clear',
    ...overrides,
  };
}

describe('automation delivery wake mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('suppresses successful legacy delivery in silent mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const delivered = await deliver(
      run(),
      automation({
        delivery: {
          mode: 'webhook',
          webhookUrl: 'https://example.com/hook',
          wakeMode: 'silent',
        },
      }),
    );

    expect(delivered).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still delivers failed runs in silent mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const delivered = await deliver(
      run({ status: 'failed', error: 'boom' }),
      automation({
        delivery: {
          mode: 'webhook',
          webhookUrl: 'https://example.com/hook',
          wakeMode: 'silent',
        },
      }),
    );

    expect(delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
