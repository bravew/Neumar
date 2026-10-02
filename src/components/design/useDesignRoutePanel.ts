import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import {
  openSettings,
  SETTINGS_DISMISSED_EVENT,
} from '@/components/settings/openSettings';

type DesignRoutePanel = 'prompt' | 'debug' | 'settings';

export function useDesignRoutePanel({
  debugOpen,
  promptAvailable,
  setPromptDrawer,
  setDebugOpen,
  onRouteDebug,
}: {
  debugOpen: boolean;
  promptAvailable: boolean;
  setPromptDrawer: Dispatch<SetStateAction<boolean>>;
  setDebugOpen: Dispatch<SetStateAction<boolean>>;
  onRouteDebug: () => void | Promise<void>;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const routePanel = new URLSearchParams(location.search).get('panel');

  const setRoutePanel = useCallback(
    (panel: DesignRoutePanel | null) => {
      const params = new URLSearchParams(location.search);
      if (panel) params.set('panel', panel);
      else params.delete('panel');
      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : '',
          hash: location.hash,
        },
        { replace: panel === null },
      );
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  useEffect(() => {
    setPromptDrawer(routePanel === 'prompt' && promptAvailable);
    if (routePanel === 'debug') {
      if (!debugOpen) {
        setDebugOpen(true);
        setPromptDrawer(false);
        void onRouteDebug();
      }
    } else {
      setDebugOpen(false);
    }
  }, [
    debugOpen,
    onRouteDebug,
    promptAvailable,
    routePanel,
    setDebugOpen,
    setPromptDrawer,
  ]);

  useEffect(() => {
    if (routePanel !== 'settings') return;
    openSettings('designMode');
  }, [routePanel]);

  useEffect(() => {
    const onDismiss = () => {
      if (routePanel !== 'settings') return;
      setRoutePanel(null);
    };
    window.addEventListener(SETTINGS_DISMISSED_EVENT, onDismiss);
    return () =>
      window.removeEventListener(SETTINGS_DISMISSED_EVENT, onDismiss);
  }, [routePanel, setRoutePanel]);

  return setRoutePanel;
}
