import { useEffect, useState, type ReactNode } from 'react';

import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { DESIGN_MODE_ENABLED } from '@/components/design/constants';
import { DesignEntryView } from '@/components/design/EntryView';
import { DesignProjectView } from '@/components/design/ProjectView';
import { DEFAULT_DESIGN_MODE_SETTINGS, useSetting } from '@/shared/db/settings';
import { getDesignProject } from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignProject } from '@/shared/types/design-mode';

export function DesignModeRoute() {
  const { t } = useLanguage();
  const { projectId } = useParams();
  const navigate = useNavigate();
  const designModeSettings = useSetting('designMode');
  const [project, setProject] = useState<DesignProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const enabled =
    DESIGN_MODE_ENABLED &&
    (designModeSettings ?? DEFAULT_DESIGN_MODE_SETTINGS).enabled;

  useEffect(() => {
    if (!enabled || !projectId) {
      setProject(null);
      setNotFound(false);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setNotFound(false);
    getDesignProject(projectId, { signal: ac.signal })
      .then((result) => {
        if (!ac.signal.aborted) setProject(result.project);
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setProject(null);
        setNotFound(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [enabled, projectId]);

  if (!enabled) return <Navigate to="/" replace />;
  if (!projectId) {
    return (
      <DesignShellLayout>
        <DesignEntryView />
      </DesignShellLayout>
    );
  }
  if (loading) {
    return (
      <DesignShellLayout>
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          {t.design.loadingProject}
        </div>
      </DesignShellLayout>
    );
  }
  if (notFound || !project) {
    return (
      <DesignShellLayout>
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-sm">
          <p>{t.design.projectNotFound}</p>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => navigate('/design')}
          >
            {t.design.backToDesigns}
          </button>
        </div>
      </DesignShellLayout>
    );
  }
  return (
    <DesignShellLayout>
      <DesignProjectView
        project={project}
        onBack={() => navigate('/design')}
        onProjectChange={setProject}
      />
    </DesignShellLayout>
  );
}

function DesignShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      {children}
    </div>
  );
}
