/**
 * QueuePickupSettings
 *
 * Configuration panel for queue-pickup heartbeat mode.
 * Shows mode selector, profile dropdown, context mode, and queue stats.
 */

import { useEffect, useState } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { AutomationHeartbeatConfig } from '@/shared/types/automation';

interface QueuePickupSettingsProps {
  heartbeat: AutomationHeartbeatConfig;
  onChange: (config: AutomationHeartbeatConfig) => void;
}

interface AgentProfile {
  id: string;
  name: string;
  role?: string;
}

interface QueueStats {
  queued: number;
  pickedUp: number;
  done: number;
}

export function QueuePickupSettings({
  heartbeat,
  onChange,
}: QueuePickupSettingsProps) {
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const mode = heartbeat.mode ?? 'standard';

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/profiles', { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setProfiles(data.data);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode !== 'queue_pickup' || !heartbeat.queueProfileId) return;

    const profileId = heartbeat.queueProfileId;
    const controller = new AbortController();
    const fetchStats = () => {
      fetch(
        `/api/automation/queue/status?profileId=${encodeURIComponent(profileId)}`,
        { signal: controller.signal },
      )
        .then((r) => r.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          if (data.success) setStats(data.data);
        })
        .catch(() => {});
    };

    fetchStats();
    const intervalId = setInterval(fetchStats, 10_000);
    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [mode, heartbeat.queueProfileId]);

  return (
    <div className="space-y-3">
      {/* Mode Selector */}
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t.automation.queuePickup.mode}
        </label>
        <div className="flex gap-2">
          {(['standard', 'queue_pickup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...heartbeat, mode: m })}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                mode === m
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {
                t.automation.queuePickup[
                  m === 'standard' ? 'standard' : 'queuePickup'
                ]
              }
            </button>
          ))}
        </div>
      </div>

      {/* Queue-pickup specific fields */}
      {mode === 'queue_pickup' && (
        <>
          {/* Profile Selector */}
          <div>
            <label
              htmlFor="queue-profile-select"
              className="text-muted-foreground mb-1 block text-xs font-medium"
            >
              {t.automation.queuePickup.profile}
            </label>
            <select
              id="queue-profile-select"
              value={heartbeat.queueProfileId ?? ''}
              onChange={(e) =>
                onChange({
                  ...heartbeat,
                  queueProfileId: e.target.value || undefined,
                })
              }
              className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">--</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.role ? `(${p.role})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Context Mode */}
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              {t.automation.queuePickup.contextMode}
            </label>
            <div className="flex gap-2">
              {(['fat', 'thin'] as const).map((cm) => (
                <button
                  key={cm}
                  type="button"
                  onClick={() => onChange({ ...heartbeat, contextMode: cm })}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    (heartbeat.contextMode ?? 'thin') === cm
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t.automation.queuePickup[cm]}
                </button>
              ))}
            </div>
          </div>

          {/* Queue Stats */}
          {stats && (
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                {t.automation.queuePickup.stats}
              </p>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className="text-foreground font-medium">{stats.queued}</p>
                  <p className="text-muted-foreground text-xs">
                    {t.automation.queuePickup.queued}
                  </p>
                </div>
                <div>
                  <p className="text-foreground font-medium">
                    {stats.pickedUp}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t.automation.queuePickup.pickedUp}
                  </p>
                </div>
                <div>
                  <p className="text-foreground font-medium">{stats.done}</p>
                  <p className="text-muted-foreground text-xs">
                    {t.automation.queuePickup.done}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
