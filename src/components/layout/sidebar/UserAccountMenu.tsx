import {
  ChevronsUpDown,
  Globe,
  LogIn,
  LogOut,
  MessageSquareHeart,
  Settings,
  User,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LANGUAGE_OPTIONS } from '@/config/locale';
import { formatChord } from '@/shared/hotkeys/format';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface UserAccountMenuProps {
  variant: 'expanded' | 'collapsed';
  displayAvatar: string;
  displayName: string;
  displayEmail?: string;
  isSignedIn: boolean;
  onSettings: () => void;
  onFeedback: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
}

export function UserAccountMenu({
  variant,
  displayAvatar,
  displayName,
  displayEmail,
  isSignedIn,
  onSettings,
  onFeedback,
  onSignOut,
  onSignIn,
}: UserAccountMenuProps) {
  const { t, language, setLanguage } = useLanguage();

  const languageSubmenu = (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="cursor-pointer">
        <Globe className="size-4" />
        <span>{t.settings.language}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {LANGUAGE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className={cn(
              'cursor-pointer',
              language === option.value && 'bg-accent',
            )}
            onClick={() => setLanguage(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  const menuContent = (
    <>
      <DropdownMenuLabel className="p-0 font-normal">
        <div className="flex items-center gap-3 px-2 py-2 text-left">
          <div className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg">
            {displayAvatar ? (
              <img
                src={displayAvatar}
                alt={displayName}
                className="size-full object-cover"
              />
            ) : (
              <User className="text-muted-foreground size-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {displayEmail && (
              <p className="text-muted-foreground truncate text-xs">
                {displayEmail}
              </p>
            )}
          </div>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem className="cursor-pointer" onClick={onSettings}>
          <Settings className="size-4" />
          <span>{t.nav.settings}</span>
          <DropdownMenuShortcut>{formatChord('mod+,')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={onFeedback}>
          <MessageSquareHeart className="size-4" />
          <span>{t.common.feedback.menuLabel}</span>
        </DropdownMenuItem>
        {languageSubmenu}
        {isSignedIn ? (
          <DropdownMenuItem
            className="cursor-pointer text-red-500 focus:text-red-500"
            onClick={onSignOut}
          >
            <LogOut className="size-4" />
            <span>{t.settings.signOut}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="cursor-pointer" onClick={onSignIn}>
            <LogIn className="size-4" />
            <span>{t.settings.signInWithNeumar}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
    </>
  );

  if (variant === 'collapsed') {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 px-2 pb-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="bg-sidebar-accent hover:ring-sidebar-foreground/20 flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-lg transition-all hover:ring-2">
              {displayAvatar ? (
                <img
                  src={displayAvatar}
                  alt={displayName}
                  className="size-full object-cover"
                />
              ) : (
                <User className="text-sidebar-foreground/70 size-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side="right"
            align="end"
            sideOffset={8}
          >
            {menuContent}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="border-sidebar-border mt-auto shrink-0 border-none p-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="hover:bg-sidebar-accent group flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors duration-200">
            <div className="bg-sidebar-accent flex size-9 items-center justify-center overflow-hidden rounded-lg">
              {displayAvatar ? (
                <img
                  src={displayAvatar}
                  alt={displayName}
                  className="size-full object-cover"
                />
              ) : (
                <User className="text-sidebar-foreground/70 size-5" />
              )}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sidebar-foreground truncate text-sm font-medium">
                {displayName}
              </p>
              {displayEmail && (
                <p className="text-sidebar-foreground/50 truncate text-xs">
                  {displayEmail}
                </p>
              )}
            </div>
            <ChevronsUpDown className="text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60 size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          side="right"
          align="end"
          sideOffset={8}
        >
          {menuContent}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
