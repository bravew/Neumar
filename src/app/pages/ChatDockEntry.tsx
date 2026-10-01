import { useEffect } from 'react';

import { useNavigate } from 'react-router-dom';

import { ChatPlaceholderPage } from '@/app/route-preload';
import { useSettingsValue } from '@/shared/db/settings';

/** Flag-on `/chat` opens the dock on Home. Flag-off keeps the placeholder. */
export function ChatDockEntry() {
  const simpleShell = useSettingsValue().ui.simpleShell;
  const navigate = useNavigate();

  useEffect(() => {
    if (!simpleShell) return;
    window.dispatchEvent(new CustomEvent('shell:open-dock'));
    navigate('/', { replace: true });
  }, [navigate, simpleShell]);

  if (simpleShell) return null;
  return <ChatPlaceholderPage />;
}
