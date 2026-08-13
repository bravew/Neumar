import { useEffect, useState } from 'react';

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { UserAccountMenu } from '@/components/layout/sidebar';
import { SettingsModal } from '@/components/settings';
import type { SettingsCategory } from '@/components/settings/types';
import type { UserProfile } from '@/shared/db/settings';
import { getSettings } from '@/shared/db/settings';
import { useAuth } from '@/shared/hooks/useAuth';

const DEFAULT_PROFILE: UserProfile = {
  nickname: 'Guest',
  avatar: '',
  customInstructions: '',
  responseStyle: 'auto',
  tone: 'professional',
  proactiveSuggestions: true,
  codeStyle: 'auto',
};

export function SidebarFooter() {
  const auth = useAuth();
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<
    SettingsCategory | undefined
  >();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const siteConnection = auth.getConnection('site');
  const isSignedIn = auth.isConnected('site');

  useEffect(() => {
    if (settingsOpen) return;
    setProfile(getSettings().profile);
  }, [settingsOpen]);

  useEffect(() => {
    const handler = (event: Event) => {
      const category =
        event instanceof CustomEvent && typeof event.detail === 'string'
          ? event.detail
          : undefined;
      setSettingsCategory((category as SettingsCategory) || undefined);
      setSettingsOpen(true);
    };
    window.addEventListener('open-settings', handler);
    return () => window.removeEventListener('open-settings', handler);
  }, []);

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
        variant="expanded"
        displayAvatar={displayAvatar}
        displayName={displayName}
        displayEmail={isSignedIn ? siteConnection?.accountEmail : undefined}
        isSignedIn={isSignedIn}
        onSettings={() => setSettingsOpen(true)}
        onFeedback={() => setFeedbackOpen(true)}
        onSignOut={() => auth.siteLogout()}
        onSignIn={() => auth.siteLogin()}
      />
      <SettingsModal
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsCategory(undefined);
        }}
        initialCategory={settingsCategory}
      />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
