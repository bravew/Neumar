import { useState } from 'react';

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { UserAccountMenu } from '@/components/layout/sidebar';
import { openSettings } from '@/components/settings/openSettings';
import { useSettingsValue } from '@/shared/db/settings';
import { useAuth } from '@/shared/hooks/useAuth';

export function SidebarFooter({
  variant = 'expanded',
}: {
  variant?: 'expanded' | 'collapsed';
}) {
  const auth = useAuth();
  const profile = useSettingsValue().profile;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const siteConnection = auth.getConnection('site');
  const isSignedIn = auth.isConnected('site');

  const displayAvatar = isSignedIn
    ? siteConnection?.avatarUrl || profile.avatar
    : profile.avatar;
  const displayName = isSignedIn
    ? siteConnection?.displayName ||
      siteConnection?.accountEmail?.split('@')[0] ||
      profile.nickname ||
      'Guest'
    : profile.nickname || 'Guest';

  return (
    <>
      <UserAccountMenu
        variant={variant}
        displayAvatar={displayAvatar}
        displayName={displayName}
        displayEmail={isSignedIn ? siteConnection?.accountEmail : undefined}
        isSignedIn={isSignedIn}
        onSettings={() => openSettings()}
        onFeedback={() => setFeedbackOpen(true)}
        onSignOut={() => auth.siteLogout()}
        onSignIn={() => auth.siteLogin()}
      />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
