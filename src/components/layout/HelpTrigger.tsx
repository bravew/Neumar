import { useState } from 'react';

import { Ghost, MessageSquareHeart, Settings, Sparkles } from 'lucide-react';

import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import { SettingsModal } from '@/components/settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { branding } from '@/config';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import { useLanguage } from '@/shared/providers/language-provider';

export function HelpTrigger() {
  const { tt } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useShortcut({
    id: 'help.open',
    chord: 'mod+shift+?',
    scope: 'global',
    descriptionKey: 'shortcuts.help.description',
    group: 'view',
    ignoreInEditable: false,
    handler: () => setMenuOpen(true),
  });

  return (
    <>
      <div className="fixed top-4 right-4 z-40">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={tt('composer.help.label')}
              className="bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 cursor-pointer items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors"
            >
              <Ghost className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={() => setSettingsOpen(true)}
            >
              <Settings className="size-4" />
              {tt('composer.help.settings')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={() => {
                window.open(
                  branding.urls.docs,
                  '_blank',
                  'noopener,noreferrer',
                );
              }}
            >
              <Sparkles className="size-4" />
              {tt('composer.help.documentation')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={() => setFeedbackOpen(true)}
            >
              <MessageSquareHeart className="size-4" />
              {tt('composer.help.sendFeedback')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
