import { useCallback, useEffect, useMemo, useState } from 'react';

import { RefreshCw } from 'lucide-react';

import { getDesignDependencies } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignDependencyStatus } from '@/shared/types/design-mode';

export function DesignModeDependenciesSettings() {
  const { t } = useLanguage();
  const [dependencies, setDependencies] = useState<DesignDependencyStatus[]>(
    [],
  );
  const [dependencyLoading, setDependencyLoading] = useState(true);
  const [dependencyError, setDependencyError] = useState('');
  const dependencyCounts = useMemo(
    () => ({
      available: dependencies.filter(
        (dependency) => dependency.state === 'available',
      ).length,
      missing: dependencies.filter(
        (dependency) => dependency.state === 'missing',
      ).length,
      notConfigured: dependencies.filter(
        (dependency) => dependency.state === 'not-configured',
      ).length,
    }),
    [dependencies],
  );

  const refreshDependencies = useCallback(async () => {
    setDependencyLoading(true);
    setDependencyError('');
    try {
      const result = await getDesignDependencies();
      setDependencies(result.dependencies);
    } catch (err) {
      setDependencyError(err instanceof Error ? err.message : String(err));
    } finally {
      setDependencyLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDependencies();
  }, [refreshDependencies]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            {t.settings.designModeDependencies}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.settings.designModeDependenciesDescription}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshDependencies()}
          disabled={dependencyLoading}
          className="border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            className={`size-4 ${dependencyLoading ? 'animate-spin' : ''}`}
          />
          {dependencyLoading
            ? t.settings.designModeDependenciesRefreshing
            : t.settings.designModeDependenciesRefresh}
        </button>
      </div>

      {dependencyError && (
        <p className="text-destructive text-sm">
          {t.settings.designModeDependenciesUnavailable} {dependencyError}
        </p>
      )}

      {dependencyLoading && dependencies.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t.settings.designModeDependenciesLoading}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <DependencyCount
              label={t.settings.designModeDependencyAvailable}
              value={dependencyCounts.available}
              tone="bg-emerald-500"
            />
            <DependencyCount
              label={t.settings.designModeDependencyMissing}
              value={dependencyCounts.missing}
              tone="bg-destructive"
            />
            <DependencyCount
              label={t.settings.designModeDependencyNotConfigured}
              value={dependencyCounts.notConfigured}
              tone="bg-amber-500"
            />
          </div>
          <div className="divide-border overflow-hidden rounded-md border">
            {dependencies.map((dependency) => (
              <DependencyRow key={dependency.id} dependency={dependency} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function DependencyCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${tone}`} />
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function DependencyRow({ dependency }: { dependency: DesignDependencyStatus }) {
  const { t } = useLanguage();
  const tone =
    dependency.state === 'available'
      ? 'bg-emerald-500'
      : dependency.state === 'not-configured'
        ? 'bg-amber-500'
        : 'bg-destructive';
  const label =
    dependency.state === 'available'
      ? t.settings.designModeDependencyAvailable
      : dependency.state === 'not-configured'
        ? t.settings.designModeDependencyNotConfigured
        : t.settings.designModeDependencyMissing;
  const usage =
    dependency.usedFor.length > 0
      ? t.settings.designModeDependencyUsedFor.replace(
          '{usage}',
          dependency.usedFor.join(' · '),
        )
      : t.settings.designModeDependencyNoUsage;

  return (
    <div className="p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <span className={`size-2 rounded-full ${tone}`} />
          <span className="truncate">{dependency.label}</span>
        </span>
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">{usage}</p>
      {dependency.version && (
        <p className="text-muted-foreground mt-1 text-xs">
          {t.settings.designModeDependencyVersion.replace(
            '{version}',
            dependency.version,
          )}
        </p>
      )}
      {dependency.reason && (
        <p className="text-muted-foreground mt-1 text-xs">
          {dependency.reason}
        </p>
      )}
      {dependency.installHint && dependency.state !== 'available' && (
        <p className="text-muted-foreground mt-1 text-xs">
          {dependency.installHint}
        </p>
      )}
    </div>
  );
}
