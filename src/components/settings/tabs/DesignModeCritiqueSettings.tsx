import { useState } from 'react';

import { useCritiqueRollout } from '@/components/design/critique/use-critique-rollout';
import { useLanguage } from '@/shared/providers/language-provider';

export function DesignModeCritiqueSettings() {
  const { t } = useLanguage();
  const rollout = useCritiqueRollout();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">
          {t.settings.designModeCritiqueHeading}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.settings.designModeCritiqueDescription}
        </p>
      </div>
      <div className="grid gap-3 rounded-md border p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              {t.settings.designModeCritiqueCurrentPhase.replace(
                '{phase}',
                rollout.phase,
              )}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {rollout.reason ?? t.settings.designModeCritiqueGateReady}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!rollout.canPromote || busy}
              title={
                rollout.canPromote
                  ? undefined
                  : t.settings.designModeCritiqueGateBlocked
              }
              onClick={() => run(rollout.promote)}
              className="border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-xs disabled:opacity-50"
            >
              {t.settings.designModeCritiquePromote}
            </button>
            <button
              type="button"
              disabled={!rollout.canRollback || busy}
              onClick={() => run(rollout.rollback)}
              className="border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-xs disabled:opacity-50"
            >
              {t.settings.designModeCritiqueRollback}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['auto', 'on', 'off'] as const).map((value) => (
            <label
              key={value}
              className="border-input flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <input
                type="radio"
                name="critique-rollout-override"
                checked={rollout.userOverride === value}
                onChange={() => run(() => rollout.setOverride(value))}
              />
              {overrideLabel(value, t.settings)}
            </label>
          ))}
        </div>
        <details className="text-muted-foreground text-xs">
          <summary className="text-foreground cursor-pointer">
            {t.settings.designModeCritiquePhaseHelp}
          </summary>
          <p className="mt-2">{t.settings.designModeCritiquePhaseHelpBody}</p>
        </details>
      </div>
    </section>
  );
}

function overrideLabel(
  value: 'auto' | 'on' | 'off',
  labels: {
    designModeCritiqueOverrideAuto: string;
    designModeCritiqueOverrideOn: string;
    designModeCritiqueOverrideOff: string;
  },
) {
  if (value === 'on') return labels.designModeCritiqueOverrideOn;
  if (value === 'off') return labels.designModeCritiqueOverrideOff;
  return labels.designModeCritiqueOverrideAuto;
}
