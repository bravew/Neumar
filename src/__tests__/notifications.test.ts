import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings, saveSettings } from '@/shared/db/settings';
import {
  agentDedupeKey,
  getNotificationPreferences,
  notifyAgentEvent,
  resetAgentNotificationStateForTests,
  setActiveTaskThread,
} from '@/shared/lib/notifications';

vi.mock('sonner', () => {
  const base = vi.fn();
  return {
    toast: Object.assign(base, {
      success: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('notifications', () => {
  beforeEach(() => {
    resetAgentNotificationStateForTests();
    saveSettings({
      ...defaultSettings,
      notifyOnCompletion: false,
      notifySoundEnabled: false,
    });
    vi.clearAllMocks();
  });

  it('dedupes terminal agent events by run and kind', async () => {
    const event = {
      runId: 'run-1',
      kind: 'succeeded' as const,
      title: 'Done',
      body: 'Task finished',
      source: 'agent-stream' as const,
      timestamp: 1000,
    };

    await expect(notifyAgentEvent(event)).resolves.toBe(true);
    await expect(notifyAgentEvent(event)).resolves.toBe(false);

    expect(agentDedupeKey(event)).toBe('run-1:succeeded');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('suppresses the completed toast while its thread is actively viewed', async () => {
    const event = {
      runId: 'run-active',
      kind: 'succeeded' as const,
      title: 'Task completed',
      body: 'Task finished',
      source: 'agent-stream' as const,
      timestamp: 1000,
    };

    setActiveTaskThread('run-active');
    // Still resolves true (sound/OS/subscribers run) — only the toast is skipped.
    await expect(notifyAgentEvent(event)).resolves.toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('still toasts completion for a thread the user is not viewing', async () => {
    setActiveTaskThread('some-other-task');
    await expect(
      notifyAgentEvent({
        runId: 'run-bg',
        kind: 'succeeded' as const,
        title: 'Task completed',
        source: 'agent-stream' as const,
        timestamp: 1000,
      }),
    ).resolves.toBe(true);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('still toasts a failure even while its thread is actively viewed', async () => {
    setActiveTaskThread('run-fail');
    await expect(
      notifyAgentEvent({
        runId: 'run-fail',
        kind: 'failed' as const,
        title: 'Task failed',
        source: 'agent-stream' as const,
        timestamp: 1000,
      }),
    ).resolves.toBe(true);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('throttles progress toasts per run', async () => {
    const baseEvent = {
      runId: 'run-2',
      kind: 'progress' as const,
      title: 'Working',
      source: 'agent-stream' as const,
    };

    await expect(
      notifyAgentEvent({ ...baseEvent, timestamp: 1000 }),
    ).resolves.toBe(true);
    await expect(
      notifyAgentEvent({ ...baseEvent, timestamp: 1200 }),
    ).resolves.toBe(false);
    await expect(
      notifyAgentEvent({ ...baseEvent, timestamp: 1900 }),
    ).resolves.toBe(true);

    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('normalizes notification preferences from settings', () => {
    saveSettings({
      ...defaultSettings,
      notifyOnCompletion: true,
      notifySoundEnabled: true,
      notifySuccessSoundId: 'missing',
      notifyFailureSoundId: 'thud',
      notifyWhileFocused: true,
    });

    expect(getNotificationPreferences()).toMatchObject({
      desktopEnabled: true,
      soundEnabled: true,
      successSoundId: 'ding',
      failureSoundId: 'thud',
      notifyWhileFocused: true,
    });
  });
});
