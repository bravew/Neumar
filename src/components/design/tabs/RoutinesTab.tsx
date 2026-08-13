import { useEffect, useMemo, useRef, useState } from 'react';

import { RefreshCw } from 'lucide-react';

import {
  runDesignRoutine,
  updateDesignRoutine,
  useDesignRoutines,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignProject,
  DesignRoutine,
  DesignSkillRecord,
  DesignSystemRecord,
} from '@/shared/types/design-mode';

import { RoutineForm } from './RoutineForm';
import { RoutineRow } from './RoutineRow';

export function RoutinesTab({
  projects,
  designSystems,
  skills,
  onOpen,
}: {
  projects: DesignProject[];
  designSystems: DesignSystemRecord[];
  skills: DesignSkillRecord[];
  onOpen: (project: DesignProject) => void;
}) {
  const { t } = useLanguage();
  const { routines, loading, error, refresh, setRoutines } =
    useDesignRoutines();
  const [runStatus, setRunStatus] = useState<Record<string, string>>({});
  const [highlightedRoutineId, setHighlightedRoutineId] = useState<
    string | null
  >(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const routineRefs = useRef(new Map<string, HTMLElement>());
  const sortedRoutines = useMemo(
    () =>
      [...routines].sort((a, b) => {
        const aTime = Date.parse(a.createdAt);
        const bTime = Date.parse(b.createdAt);
        return (
          (Number.isFinite(bTime) ? bTime : 0) -
          (Number.isFinite(aTime) ? aTime : 0)
        );
      }),
    [routines],
  );

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!highlightedRoutineId) return;
    const node = routineRefs.current.get(highlightedRoutineId);
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedRoutineId, sortedRoutines]);

  const handleRoutineCreated = async (routine: DesignRoutine) => {
    setRoutines((prev) => [
      routine,
      ...prev.filter((item) => item.id !== routine.id),
    ]);
    setHighlightedRoutineId(routine.id);
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      highlightTimeoutRef.current = null;
      setHighlightedRoutineId(null);
    }, 2400);
  };

  const runRoutine = async (routine: DesignRoutine) => {
    setRunStatus((prev) => ({
      ...prev,
      [routine.id]: t.design.routines.statusQueued,
    }));
    try {
      const { run } = await runDesignRoutine(routine.id);
      setRunStatus((prev) => ({ ...prev, [routine.id]: run.status }));
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null;
        void refresh();
      }, 1200);
    } catch (err) {
      setRunStatus((prev) => ({
        ...prev,
        [routine.id]: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const toggleRoutine = async (routine: DesignRoutine) => {
    await updateDesignRoutine(routine.id, { enabled: !routine.enabled });
    await refresh();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
      <RoutineForm
        projects={projects}
        designSystems={designSystems}
        skills={skills}
        onCreated={handleRoutineCreated}
        onOpen={onOpen}
      />
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t.design.routines.saved}</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
          >
            <RefreshCw className="size-4" />
            {t.design.routines.refresh}
          </button>
        </div>
        {loading ? (
          <p className="text-muted-foreground text-sm">
            {t.design.routines.loading}
          </p>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : routines.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t.design.routines.empty}
          </p>
        ) : (
          <div className="grid gap-3">
            {sortedRoutines.map((routine) => (
              <RoutineRow
                key={routine.id}
                routine={routine}
                runStatus={runStatus[routine.id]}
                highlighted={highlightedRoutineId === routine.id}
                rowRef={(node) => {
                  if (node) routineRefs.current.set(routine.id, node);
                  else routineRefs.current.delete(routine.id);
                }}
                onRun={() => void runRoutine(routine)}
                onToggle={() => void toggleRoutine(routine)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
