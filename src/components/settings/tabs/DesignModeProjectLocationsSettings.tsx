import { useCallback, useEffect, useId, useState } from 'react';

import { FolderPlus, RefreshCw, Trash2 } from 'lucide-react';

import {
  addDesignProjectLocation,
  listDesignProjectLocations,
  removeDesignProjectLocation,
  scanDesignProjectLocations,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignProjectLocationRecord } from '@/shared/types/design-mode';

export function DesignModeProjectLocationsSettings() {
  const { t } = useLanguage();
  const [locations, setLocations] = useState<DesignProjectLocationRecord[]>([]);
  const [pathInput, setPathInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [errorSource, setErrorSource] = useState<'path' | 'panel' | null>(null);
  const [status, setStatus] = useState('');
  const pathInputId = useId();
  const feedbackId = useId();

  const refreshLocations = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setErrorSource(null);
    try {
      const result = await listDesignProjectLocations({ signal });
      if (signal?.aborted) return;
      setLocations(result.locations ?? []);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setErrorSource('panel');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshLocations(controller.signal);
    return () => controller.abort();
  }, [refreshLocations]);

  const submitLocation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPath = pathInput.trim();
    if (!nextPath) return;
    setAdding(true);
    setError('');
    setErrorSource(null);
    setStatus('');
    try {
      const result = await addDesignProjectLocation(nextPath);
      setLocations(result.locations ?? []);
      setPathInput('');
      setStatus(t.settings.designModeProjectLocationAdded);
    } catch (err) {
      setErrorSource('path');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const scanLocations = async () => {
    setScanning(true);
    setError('');
    setErrorSource(null);
    setStatus('');
    try {
      const result = await scanDesignProjectLocations();
      setLocations(result.locations ?? []);
      setStatus(t.settings.designModeProjectLocationScanned);
    } catch (err) {
      setErrorSource('panel');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  const removeLocation = async (path: string) => {
    setRemovingPath(path);
    setError('');
    setErrorSource(null);
    setStatus('');
    try {
      const result = await removeDesignProjectLocation(path);
      setLocations(result.locations ?? []);
      setStatus(t.settings.designModeProjectLocationRemoved);
    } catch (err) {
      setErrorSource('panel');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingPath(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            {t.settings.designModeProjectLocations}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {t.settings.designModeProjectLocationsDescription}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void scanLocations()}
          disabled={loading || scanning}
          className="border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${scanning ? 'animate-spin' : ''}`} />
          {scanning
            ? t.settings.designModeProjectLocationsScanning
            : t.settings.designModeProjectLocationsScan}
        </button>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={submitLocation}
      >
        <label className="grid gap-1.5 text-sm" htmlFor={pathInputId}>
          <span className="font-medium">
            {t.settings.designModeProjectLocationPath}
          </span>
          <input
            id={pathInputId}
            value={pathInput}
            placeholder={t.settings.designModeProjectLocationPathPlaceholder}
            aria-describedby={feedbackId}
            aria-invalid={errorSource === 'path' && Boolean(error)}
            onChange={(event) => setPathInput(event.target.value)}
            className="border-input bg-background h-10 rounded-md border px-3"
          />
        </label>
        <button
          type="submit"
          disabled={adding || !pathInput.trim()}
          className="border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center justify-center gap-2 self-end rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FolderPlus className="size-4" />
          {adding
            ? t.settings.designModeProjectLocationsAdding
            : t.settings.designModeProjectLocationsAdd}
        </button>
      </form>

      <div id={feedbackId} className="space-y-1">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {t.settings.designModeProjectLocationsUnavailable} {error}
          </p>
        )}
        {status && (
          <p aria-live="polite" className="text-muted-foreground text-sm">
            {status}
          </p>
        )}
      </div>

      {loading && locations.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t.settings.designModeProjectLocationsLoading}
        </p>
      ) : (
        <div className="divide-border overflow-hidden rounded-md border">
          {locations.map((location) => (
            <ProjectLocationRow
              key={location.path}
              location={location}
              removing={removingPath === location.path}
              onRemove={removeLocation}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectLocationRow({
  location,
  removing,
  onRemove,
}: {
  location: DesignProjectLocationRecord;
  removing: boolean;
  onRemove: (path: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b p-3 text-sm last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs break-all">{location.path}</span>
          <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
            {location.isDefault
              ? t.settings.designModeProjectLocationDefault
              : t.settings.designModeProjectLocationConfigured}
          </span>
          {!location.exists && (
            <span className="text-destructive rounded px-2 py-0.5 text-xs">
              {t.settings.designModeProjectLocationMissing}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {t.settings.designModeProjectLocationProjects.replace(
            '{count}',
            String(location.projectCount),
          )}
        </p>
        {location.error && (
          <p className="text-destructive mt-1 text-xs">{location.error}</p>
        )}
      </div>
      {!location.isDefault && (
        <button
          type="button"
          onClick={() => onRemove(location.path)}
          disabled={removing}
          aria-label={t.settings.designModeProjectLocationRemoveAria.replace(
            '{path}',
            location.path,
          )}
          className="border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-8 items-center gap-2 rounded-md border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-3.5" />
          {t.settings.designModeProjectLocationRemove}
        </button>
      )}
    </div>
  );
}
