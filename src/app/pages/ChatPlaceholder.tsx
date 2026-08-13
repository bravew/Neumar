import { Navigate } from 'react-router-dom';

import { MessageCircle } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { DEFAULT_MODES_SETTINGS, useSetting } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

export function ChatPlaceholderPage() {
  const { t } = useLanguage();
  const modeSettings = {
    ...DEFAULT_MODES_SETTINGS,
    ...useSetting('modes'),
  };

  if (!modeSettings.chatEnabled) return <Navigate to="/" replace />;

  return (
    <SidebarProvider>
      <div className="bg-sidebar flex h-screen overflow-hidden">
        <LeftSidebar tasks={[]} />
        <main className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl p-8 text-center shadow-sm">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl">
            <MessageCircle className="size-6" />
          </div>
          <h1 className="text-foreground mt-4 text-2xl font-semibold">
            {t.modes.chat.comingSoonTitle}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-md text-sm">
            {t.modes.chat.comingSoonDescription}
          </p>
        </main>
      </div>
    </SidebarProvider>
  );
}
