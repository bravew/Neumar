import { useEffect, useState } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

export function useEntrySettingsPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const panel = new URLSearchParams(location.search).get('panel');
    setSettingsOpen(panel === 'settings');
  }, [location.search]);

  const openSettings = () => {
    const params = new URLSearchParams(location.search);
    params.set('panel', 'settings');
    navigate({
      pathname: location.pathname,
      search: `?${params.toString()}`,
      hash: location.hash,
    });
  };

  const onSettingsOpenChange = (open: boolean) => {
    if (open) {
      openSettings();
      return;
    }
    const params = new URLSearchParams(location.search);
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

  return {
    location,
    navigate,
    settingsOpen,
    openSettings,
    onSettingsOpenChange,
  };
}
