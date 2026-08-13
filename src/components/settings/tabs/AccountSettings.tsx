/**
 * Account Settings Tab
 *
 * Profile management hub. Shows the user's profile with avatar upload,
 * nickname editing, site sign-in/sign-out, and personal preferences
 * that are applied to every conversation (similar to Claude Desktop).
 */

import { useEffect, useRef, useState } from 'react';

import { Camera, LogOut, MessageSquare, User } from 'lucide-react';

import { SiteSignInButton } from '@/components/auth/SiteSignInButton';
import { useAuth } from '@/shared/hooks/useAuth';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';

const RESPONSE_STYLE_OPTIONS = ['concise', 'detailed', 'auto'] as const;
const TONE_OPTIONS = ['professional', 'casual', 'friendly', 'auto'] as const;
const CODE_STYLE_OPTIONS = ['commented', 'minimal', 'auto'] as const;

export function AccountSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();
  const auth = useAuth();
  const [avatarError, setAvatarError] = useState(false);

  // Local drafts for text fields — only commit to settings on blur
  const [draftNickname, setDraftNickname] = useState(settings.profile.nickname);
  const [draftInstructions, setDraftInstructions] = useState(
    settings.profile.customInstructions ?? '',
  );

  // Sync drafts when settings change externally (e.g. import, reset)
  useEffect(() => {
    setDraftNickname(settings.profile.nickname);
  }, [settings.profile.nickname]);

  useEffect(() => {
    setDraftInstructions(settings.profile.customInstructions ?? '');
  }, [settings.profile.customInstructions]);

  const siteConnection = auth.getConnection('site');
  const isSignedIn = auth.isConnected('site');

  // Reset avatar error when the connection/avatar URL changes
  useEffect(() => {
    setAvatarError(false);
  }, [siteConnection?.avatarUrl]);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onSettingsChange({
          ...settings,
          profile: {
            ...settings.profile,
            avatar: reader.result as string,
          },
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSiteSignIn = async () => {
    await auth.siteLogin();
  };

  const updateProfile = (updates: Partial<typeof settings.profile>) => {
    onSettingsChange({
      ...settings,
      profile: {
        ...settings.profile,
        ...updates,
      },
    });
  };

  return (
    <div className="space-y-8">
      {/* Profile Section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-foreground text-sm font-semibold">
              {t.settings.account}
            </h3>
            <p className="text-muted-foreground text-xs">
              {t.settings.manageProfile}
            </p>
          </div>
          {isSignedIn && (
            <button
              onClick={() => auth.siteLogout()}
              className="text-muted-foreground hover:text-destructive flex items-center gap-1.5 text-xs transition-colors"
              aria-label={t.settings.signOut}
            >
              <LogOut className="size-3" />
              {t.settings.signOut}
            </button>
          )}
        </div>

        {isSignedIn && siteConnection ? (
          /* Signed-in profile card */
          <div className="border-border flex items-center gap-4 rounded-lg border p-4">
            <div className="relative">
              {siteConnection.avatarUrl && !avatarError ? (
                <img
                  src={siteConnection.avatarUrl}
                  alt="Profile"
                  className="size-14 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className="bg-muted flex size-14 items-center justify-center rounded-full">
                  <User className="text-muted-foreground size-6" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-foreground font-medium">
                {siteConnection.displayName}
              </p>
              <p className="text-muted-foreground text-sm">
                {siteConnection.accountEmail}
              </p>
            </div>
          </div>
        ) : (
          /* Not signed in — show avatar uploader + site sign-in */
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <button
                onClick={handleAvatarClick}
                className="bg-muted border-border hover:border-primary/50 group relative size-16 cursor-pointer overflow-hidden rounded-full border-2 border-dashed transition-colors"
                aria-label={t.settings.uploadAvatar}
              >
                {settings.profile.avatar ? (
                  <img
                    src={settings.profile.avatar}
                    alt="Avatar"
                    className="size-full object-cover"
                  />
                ) : (
                  <User className="text-muted-foreground absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="size-4 text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
                aria-label={t.settings.uploadAvatar}
              />
              <div className="flex-1">
                <input
                  type="text"
                  value={draftNickname}
                  onChange={(e) => setDraftNickname(e.target.value)}
                  onBlur={() => {
                    if (draftNickname !== settings.profile.nickname) {
                      updateProfile({ nickname: draftNickname });
                    }
                  }}
                  placeholder={t.settings.enterNickname}
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring block h-9 w-full max-w-xs rounded-lg border px-3 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
                />
              </div>
            </div>

            <div className="border-border rounded-lg border p-4">
              <p className="text-muted-foreground mb-3 text-xs">
                {t.settings.siteSignInPrompt}
              </p>
              <SiteSignInButton
                onSignIn={handleSiteSignIn}
                label={t.settings.signInWithNeumar}
                loadingLabel={t.settings.signingIn}
              />
            </div>
          </div>
        )}
      </section>

      {/* Preferences Section — Custom Instructions */}
      <section>
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="text-muted-foreground size-4" />
            <h3 className="text-foreground text-sm font-semibold">
              {t.settings.preferencesTitle}
            </h3>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {t.settings.preferencesDescription}
          </p>
        </div>

        {/* Custom Instructions */}
        <div className="space-y-4">
          <div>
            <label className="text-foreground mb-1.5 block text-xs font-medium">
              {t.settings.customInstructionsLabel}
            </label>
            <textarea
              value={draftInstructions}
              onChange={(e) => setDraftInstructions(e.target.value)}
              onBlur={() => {
                if (
                  draftInstructions !==
                  (settings.profile.customInstructions ?? '')
                ) {
                  updateProfile({ customInstructions: draftInstructions });
                }
              }}
              placeholder={t.settings.customInstructionsPlaceholder}
              rows={4}
              maxLength={2000}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring block w-full resize-y rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {t.settings.customInstructionsHint}
            </p>
          </div>

          {/* Response Style */}
          <div className="border-border rounded-lg border p-4">
            <div className="space-y-4">
              <PreferenceSelect
                label={t.settings.prefResponseStyle}
                description={t.settings.prefResponseStyleDesc}
                value={settings.profile.responseStyle ?? 'auto'}
                options={RESPONSE_STYLE_OPTIONS}
                labels={{
                  concise: t.settings.prefStyleConcise,
                  detailed: t.settings.prefStyleDetailed,
                  auto: t.settings.prefStyleAuto,
                }}
                onChange={(v) =>
                  updateProfile({
                    responseStyle: v as typeof settings.profile.responseStyle,
                  })
                }
              />

              <PreferenceSelect
                label={t.settings.prefTone}
                description={t.settings.prefToneDesc}
                value={settings.profile.tone ?? 'auto'}
                options={TONE_OPTIONS}
                labels={{
                  professional: t.settings.prefToneProfessional,
                  casual: t.settings.prefToneCasual,
                  friendly: t.settings.prefToneFriendly,
                  auto: t.settings.prefToneAuto,
                }}
                onChange={(v) =>
                  updateProfile({
                    tone: v as typeof settings.profile.tone,
                  })
                }
              />

              <PreferenceSelect
                label={t.settings.prefCodeStyle}
                description={t.settings.prefCodeStyleDesc}
                value={settings.profile.codeStyle ?? 'auto'}
                options={CODE_STYLE_OPTIONS}
                labels={{
                  commented: t.settings.prefCodeCommented,
                  minimal: t.settings.prefCodeMinimal,
                  auto: t.settings.prefCodeAuto,
                }}
                onChange={(v) =>
                  updateProfile({
                    codeStyle: v as typeof settings.profile.codeStyle,
                  })
                }
              />

              {/* Proactive Suggestions Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-foreground text-sm">
                    {t.settings.prefProactiveSuggestions}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t.settings.prefProactiveSuggestionsDesc}
                  </p>
                </div>
                <button
                  onClick={() =>
                    updateProfile({
                      proactiveSuggestions: !(
                        settings.profile.proactiveSuggestions ?? true
                      ),
                    })
                  }
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
                    (settings.profile.proactiveSuggestions ?? true)
                      ? 'bg-primary'
                      : 'bg-muted-foreground/30',
                  )}
                  role="switch"
                  aria-checked={settings.profile.proactiveSuggestions ?? true}
                  aria-label={t.settings.prefProactiveSuggestions}
                >
                  <span
                    className={cn(
                      'inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform',
                      (settings.profile.proactiveSuggestions ?? true)
                        ? 'translate-x-4.5'
                        : 'translate-x-0.5',
                    )}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Reusable preference dropdown row */
function PreferenceSelect<T extends string>({
  label,
  description,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  description: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={label}
        className="border-input bg-background text-foreground focus:ring-ring h-8 w-32 shrink-0 rounded-md border px-2 text-xs focus:border-transparent focus:ring-2 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labels[opt]}
          </option>
        ))}
      </select>
    </div>
  );
}
