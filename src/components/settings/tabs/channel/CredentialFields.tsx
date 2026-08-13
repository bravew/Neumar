import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { ApiKeyField } from '../../components/ApiKeyField';
import { INPUT_CLASS, type Platform } from './types';

export function CredentialFields({
  platform,
  values,
  onChange,
}: {
  platform: Platform;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const { t } = useLanguage();
  const s = t.settings;

  function PwField({
    k,
    label,
    hint,
  }: {
    k: string;
    label: string;
    hint?: string;
  }) {
    return (
      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">
          {label}
        </label>
        <ApiKeyField
          value={values[k] ?? ''}
          onChange={(v) => onChange(k, v)}
          placeholder={hint}
          className={cn(INPUT_CLASS, 'w-full')}
        />
      </div>
    );
  }

  if (platform === 'telegram')
    return (
      <PwField
        k="token"
        label={s?.channelBotToken ?? 'Bot Token'}
        hint={s?.channelTokenPlaceholder ?? 'Paste token from @BotFather'}
      />
    );

  if (platform === 'discord')
    return (
      <PwField
        k="token"
        label={s?.channelDiscordToken ?? 'Bot Token'}
        hint={s?.channelDiscordTokenPlaceholder ?? 'Discord bot token'}
      />
    );

  if (platform === 'lark')
    return (
      <>
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            {s?.channelAppId ?? 'App ID'}
          </label>
          <input
            type="text"
            value={values.appId ?? ''}
            onChange={(e) => onChange('appId', e.target.value)}
            placeholder={
              s?.channelAppIdPlaceholder ?? 'App ID from Feishu Open Platform'
            }
            className={INPUT_CLASS}
          />
        </div>
        <PwField
          k="appSecret"
          label={s?.channelAppSecret ?? 'App Secret'}
          hint={s?.channelAppSecretPlaceholder ?? 'App Secret'}
        />
      </>
    );

  if (platform === 'imessage')
    return (
      <>
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">
            BlueBubbles server URL
          </label>
          <input
            type="text"
            value={values.serverUrl ?? ''}
            onChange={(e) => onChange('serverUrl', e.target.value)}
            placeholder="http://127.0.0.1:1234"
            className={INPUT_CLASS}
          />
        </div>
        <PwField
          k="password"
          label="BlueBubbles password"
          hint="Server password configured in BlueBubbles"
        />
        <p className="text-muted-foreground text-xs">
          Requires{' '}
          <a
            className="underline"
            href="https://bluebubbles.app/install/"
            target="_blank"
            rel="noopener noreferrer"
          >
            BlueBubbles Server
          </a>{' '}
          running on a Mac. iMessage is on-device and macOS-only.
        </p>
      </>
    );

  if (platform === 'whatsapp')
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        <strong>Terms of Service warning.</strong> Automating WhatsApp Web may
        violate Meta&rsquo;s ToS and risk account suspension. The adapter ships
        disabled until you acknowledge the risk by setting{' '}
        <code>whatsapp.tos.acknowledgedAt</code>. Outbound sends are not yet
        implemented.
      </div>
    );

  // slack — uses ApiKeyField (write-only) consistent with other platforms
  return (
    <>
      <PwField
        k="botToken"
        label={s?.channelSlackBotToken ?? 'Bot Token'}
        hint={s?.channelSlackBotTokenPlaceholder ?? 'xoxb-...'}
      />
      <PwField
        k="appToken"
        label={s?.channelSlackAppToken ?? 'App-Level Token'}
        hint={s?.channelSlackAppTokenPlaceholder ?? 'xapp-...'}
      />
    </>
  );
}
