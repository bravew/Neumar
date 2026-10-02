import { useEffect } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import {
  openSettings as dispatchOpenSettings,
  SETTINGS_DISMISSED_EVENT,
} from '@/components/settings/openSettings';

export function useEntrySettingsPanel() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const panel = new URLSearchParams(location.search).get('panel');
    if (panel === 'settings') dispatchOpenSettings('designMode');
  }, [location.search]);

  useEffect(() => {
    const onDismiss = () => {
      const params = new URLSearchParams(location.search);
      if (params.get('panel') !== 'settings') return;
      params.delete('panel');
      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : '',
          hash: location.hash,
        },
        { replace: true },
      );
    };
    window.addEventListener(SETTINGS_DISMISSED_EVENT, onDismiss);
    return () =>
      window.removeEventListener(SETTINGS_DISMISSED_EVENT, onDismiss);
  }, [location.hash, location.pathname, location.search, navigate]);

  const openSettings = () => {
    const params = new URLSearchParams(location.search);
    params.set('panel', 'settings');
    navigate({
      pathname: location.pathname,
      search: `?${params.toString()}`,
      hash: location.hash,
    });
  };

  return {
    location,
    navigate,
    openSettings,
  };
}
