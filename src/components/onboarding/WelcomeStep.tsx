/**
 * Onboarding Step 1: Welcome & Profile
 *
 * Collects user nickname and avatar on first launch.
 */

import { useCallback, useRef } from 'react';

import { Camera, User } from 'lucide-react';

import ImageLogo from '@/assets/logo.png';
import { APP_NAME } from '@/config';
import { LANGUAGE_OPTIONS, type Language } from '@/config/locale';
import type { Settings } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

interface WelcomeStepProps {
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export function WelcomeStep({ settings, onSettingsChange }: WelcomeStepProps) {
  const { t, tt, language, setLanguage } = useLanguage();
  const ob = t.onboarding;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use refs to avoid stale closure in FileReader.onloadend:
  // if the user types a name and THEN the avatar finishes loading,
  // the callback must read the latest settings (with the typed name)
  // instead of the stale capture from when the file was selected.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onChangeRef = useRef(onSettingsChange);
  onChangeRef.current = onSettingsChange;

  const handleAvatarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const current = settingsRef.current;
          onChangeRef.current({
            ...current,
            profile: { ...current.profile, avatar: reader.result as string },
          });
        };
        reader.readAsDataURL(file);
      }
    },
    [],
  );

  return (
    <div className="flex flex-col items-center">
      <img src={ImageLogo} alt={APP_NAME} className="mb-4 size-16" />
      <h1 className="text-foreground text-3xl font-bold">
        {tt('onboarding.welcomeTitle', { appName: APP_NAME })}
      </h1>
      <p className="text-muted-foreground mt-3 text-center text-base">
        {ob.welcomeSubtitle}
      </p>

      <div className="mt-10 flex w-full max-w-sm flex-col items-center gap-6">
        {/* Avatar */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="bg-muted border-border hover:border-primary/50 group relative size-24 cursor-pointer overflow-hidden rounded-full border-2 border-dashed transition-colors"
          aria-label={ob.uploadAvatar}
        >
          {settings.profile.avatar ? (
            <img
              src={settings.profile.avatar}
              alt="Avatar"
              className="size-full object-cover"
            />
          ) : (
            <User className="text-muted-foreground absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="size-5 text-white" />
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          className="hidden"
          aria-label={ob.uploadAvatar}
        />

        {/* Nickname */}
        <input
          type="text"
          value={settings.profile.nickname}
          onChange={(e) =>
            onSettingsChange({
              ...settings,
              profile: { ...settings.profile, nickname: e.target.value },
            })
          }
          placeholder={ob.enterName}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring block h-11 w-full rounded-lg border px-4 text-center text-base focus:border-transparent focus:ring-2 focus:outline-none"
          autoFocus
        />

        {/* Language */}
        <div className="flex w-full flex-col gap-2">
          <select
            aria-label={ob.languageLabel}
            value={language}
            onChange={(e) => {
              const lang = e.target.value as Language;
              setLanguage(lang);
              onSettingsChange({ ...settings, language: lang });
            }}
            className="border-input bg-background text-foreground focus:ring-ring h-11 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
          >
            {LANGUAGE_OPTIONS.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
