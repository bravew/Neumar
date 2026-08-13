import { useCallback, useEffect, useState } from 'react';

import {
  getDesignJuryStatus,
  runDesignJury,
} from '@/shared/hooks/useDesignMode';
import type { DesignJuryRun, DesignProject } from '@/shared/types/design-mode';

import { firstReviewableArtifactPath } from './critique/artifacts';

export function useDesignProjectJury(project: DesignProject) {
  const [juryEnabled, setJuryEnabled] = useState(false);
  const [juryLoading, setJuryLoading] = useState(false);
  const [juryRun, setJuryRun] = useState<DesignJuryRun | null>(null);
  const [juryError, setJuryError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void getDesignJuryStatus({ signal: ac.signal })
      .then((data) => {
        if (!ac.signal.aborted) setJuryEnabled(Boolean(data.enabled));
      })
      .catch(() => {
        if (!ac.signal.aborted) setJuryEnabled(false);
      });
    return () => ac.abort();
  }, []);

  const runJury = useCallback(async () => {
    setJuryLoading(true);
    setJuryError(null);
    try {
      const result = await runDesignJury(project.id, {
        artifactPath: firstReviewableArtifactPath(project),
      });
      setJuryRun(result.run);
    } catch (err) {
      setJuryError(err instanceof Error ? err.message : String(err));
    } finally {
      setJuryLoading(false);
    }
  }, [project]);

  return { juryEnabled, juryError, juryLoading, juryRun, runJury };
}
