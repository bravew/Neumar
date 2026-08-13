import { useEffect, useState } from 'react';

import type { useDesignMdState } from '@/shared/hooks/useDesignMdState';
import {
  finalizeDesignProject,
  getDesignFileLocation,
  getDesignProject,
} from '@/shared/hooks/useDesignMode';
import type { DesignProject } from '@/shared/types/design-mode';

export function useDesignProjectFinalizer({
  project,
  designMdState,
  onError,
  onProjectChange,
}: {
  project: DesignProject;
  designMdState: ReturnType<typeof useDesignMdState>;
  onError: (message: string | null) => void;
  onProjectChange: (project: DesignProject) => void;
}) {
  const [finalizing, setFinalizing] = useState(false);
  const [continueCopied, setContinueCopied] = useState(false);

  useEffect(() => {
    if (!continueCopied) return;
    const id = window.setTimeout(() => setContinueCopied(false), 2400);
    return () => window.clearTimeout(id);
  }, [continueCopied]);

  const finalizeDesign = async () => {
    setFinalizing(true);
    onError(null);
    try {
      await finalizeDesignProject(project.id);
      await designMdState.refresh();
      const fresh = await getDesignProject(project.id);
      onProjectChange(fresh.project);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinalizing(false);
    }
  };

  const continueInCli = async () => {
    if (!designMdState.exists) return;
    try {
      const location = await getDesignFileLocation(project.id, 'DESIGN.md');
      const prompt = [
        `Continue the Neuma DesignMode project "${project.title}".`,
        `Project id: ${project.id}`,
        `Read ${location.absolutePath} first and treat DESIGN.md as the source of truth for design intent.`,
        designMdState.isStale
          ? 'The app marked DESIGN.md as stale; compare it against current files before editing.'
          : 'The app marked DESIGN.md as fresh at handoff time.',
      ].join('\n');
      await navigator.clipboard?.writeText(prompt);
      setContinueCopied(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return { finalizing, continueCopied, finalizeDesign, continueInCli };
}
