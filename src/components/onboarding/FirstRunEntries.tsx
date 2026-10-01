import { Navigate } from 'react-router-dom';

import { QuickStartWizardPage, SetupPage } from '@/app/route-preload';
import { useSettingsValue } from '@/shared/db/settings';

export function SetupEntry() {
  const simpleShell = useSettingsValue().ui.simpleShell;
  if (simpleShell) return <Navigate to="/onboarding?step=install" replace />;
  return <SetupPage />;
}

export function QuickStartEntry() {
  const simpleShell = useSettingsValue().ui.simpleShell;
  if (simpleShell) return <Navigate to="/onboarding?step=idea" replace />;
  return <QuickStartWizardPage />;
}
