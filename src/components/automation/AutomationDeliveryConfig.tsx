/**
 * AutomationDeliveryConfig
 *
 * Notification delivery form section.
 */

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  AutomationChannelDelivery,
  AutomationDelivery,
  ChannelPlatformOrDesktop,
  DeliveryMode,
  WakeMode,
} from '@/shared/types/automation';

interface AutomationDeliveryConfigProps {
  delivery: AutomationDelivery;
  onChange: (delivery: AutomationDelivery) => void;
  channelDelivery?: AutomationChannelDelivery;
  onChannelDeliveryChange?: (
    delivery: AutomationChannelDelivery | undefined,
  ) => void;
}

const DELIVERY_MODE_VALUES: DeliveryMode[] = [
  'none',
  'channel',
  'desktop',
  'slack',
  'webhook',
];

const CHANNEL_PLATFORMS: ChannelPlatformOrDesktop[] = [
  'telegram',
  'discord',
  'slack',
  'lark',
  'desktop',
];
const WAKE_MODE_VALUES: WakeMode[] = ['always', 'silent'];

function createDefaultChannelDelivery(
  existing?: AutomationChannelDelivery,
): AutomationChannelDelivery {
  return {
    platform: existing?.platform ?? 'desktop',
    conversationId: existing?.conversationId || 'desktop',
    suppressEmpty: existing?.suppressEmpty ?? true,
    maxLength: existing?.maxLength,
    format: existing?.format,
    wakeMode: existing?.wakeMode ?? 'always',
    suppressSuccessNotification: existing?.suppressSuccessNotification ?? false,
  };
}

export function AutomationDeliveryConfig({
  delivery,
  onChange,
  channelDelivery,
  onChannelDeliveryChange,
}: AutomationDeliveryConfigProps) {
  const { t } = useLanguage();
  const showWakeControls = delivery.mode !== 'none';
  const activeWakeMode =
    delivery.mode === 'channel'
      ? (channelDelivery?.wakeMode ?? 'always')
      : (delivery.wakeMode ?? 'always');
  const activeSuppressSuccess =
    delivery.mode === 'channel'
      ? (channelDelivery?.suppressSuccessNotification ?? false)
      : (delivery.suppressSuccessNotification ?? false);

  const updateWakeMode = (wakeMode: WakeMode) => {
    if (delivery.mode === 'channel' && onChannelDeliveryChange) {
      onChannelDeliveryChange({
        ...createDefaultChannelDelivery(channelDelivery),
        wakeMode,
      });
      return;
    }
    onChange({ ...delivery, wakeMode });
  };

  const updateSuppressSuccess = (suppressSuccessNotification: boolean) => {
    if (delivery.mode === 'channel' && onChannelDeliveryChange) {
      onChannelDeliveryChange({
        ...createDefaultChannelDelivery(channelDelivery),
        suppressSuccessNotification,
      });
      return;
    }
    onChange({ ...delivery, suppressSuccessNotification });
  };

  return (
    <div className="space-y-4">
      {/* Mode Select */}
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t.automation.fields.delivery}
        </label>
        <select
          value={delivery.mode}
          onChange={(e) => {
            const mode = e.target.value as DeliveryMode;
            onChange({
              ...delivery,
              mode,
            });
            if (mode === 'channel' && onChannelDeliveryChange) {
              onChannelDeliveryChange(
                createDefaultChannelDelivery(channelDelivery),
              );
            }
          }}
          className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
          aria-label={t.automation.fields.delivery}
        >
          {DELIVERY_MODE_VALUES.map((mode) => (
            <option key={mode} value={mode}>
              {t.automation.delivery[mode]}
            </option>
          ))}
        </select>
      </div>

      {/* Slack URL */}
      {delivery.mode === 'slack' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {t.automation.delivery.slackUrl}
          </label>
          <input
            type="url"
            value={delivery.slackWebhookUrl ?? ''}
            onChange={(e) =>
              onChange({ ...delivery, slackWebhookUrl: e.target.value })
            }
            placeholder="https://hooks.slack.com/services/..."
            className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
            aria-label={t.automation.delivery.slackUrl}
          />
        </div>
      )}

      {/* Webhook URL */}
      {delivery.mode === 'webhook' && (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {t.automation.delivery.webhookUrl}
          </label>
          <input
            type="url"
            value={delivery.webhookUrl ?? ''}
            onChange={(e) =>
              onChange({ ...delivery, webhookUrl: e.target.value })
            }
            placeholder="https://example.com/webhook"
            className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
            aria-label={t.automation.delivery.webhookUrl}
          />
        </div>
      )}

      {/* Channel Delivery Config */}
      {delivery.mode === 'channel' && onChannelDeliveryChange && (
        <div className="space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              {t.automation.channelDelivery.platform}
            </label>
            <select
              value={channelDelivery?.platform ?? 'desktop'}
              onChange={(e) =>
                onChannelDeliveryChange({
                  ...createDefaultChannelDelivery(channelDelivery),
                  platform: e.target.value as ChannelPlatformOrDesktop,
                  conversationId:
                    e.target.value === 'desktop'
                      ? 'desktop'
                      : channelDelivery?.conversationId === 'desktop'
                        ? ''
                        : (channelDelivery?.conversationId ?? ''),
                })
              }
              className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
            >
              {CHANNEL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {t.automation.channelDelivery[p]}
                </option>
              ))}
            </select>
          </div>

          {channelDelivery?.platform !== 'desktop' && (
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                {t.automation.channelDelivery.conversationId}
              </label>
              <input
                type="text"
                value={channelDelivery?.conversationId ?? ''}
                onChange={(e) =>
                  onChannelDeliveryChange({
                    ...createDefaultChannelDelivery(channelDelivery),
                    conversationId: e.target.value,
                  })
                }
                placeholder={t.automation.channelDelivery.conversationId}
                className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          )}

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={channelDelivery?.suppressEmpty ?? true}
              onChange={(e) =>
                onChannelDeliveryChange({
                  ...createDefaultChannelDelivery(channelDelivery),
                  suppressEmpty: e.target.checked,
                })
              }
              className="accent-primary size-4 rounded"
            />
            <span className="text-foreground text-sm">
              {t.automation.channelDelivery.suppressEmpty}
            </span>
          </label>
        </div>
      )}

      {showWakeControls && (
        <div className="space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              {t.automation.delivery.wakeMode}
            </label>
            <select
              value={activeWakeMode}
              onChange={(e) => updateWakeMode(e.target.value as WakeMode)}
              className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
              aria-label={t.automation.delivery.wakeMode}
            >
              {WAKE_MODE_VALUES.map((mode) => (
                <option key={mode} value={mode}>
                  {t.automation.delivery.wakeModes[mode]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={activeSuppressSuccess}
              onChange={(e) => updateSuppressSuccess(e.target.checked)}
              className="accent-primary size-4 rounded"
              aria-label={t.automation.delivery.suppressSuccessNotification}
            />
            <span className="text-foreground text-sm">
              {t.automation.delivery.suppressSuccessNotification}
            </span>
          </label>
        </div>
      )}

      {/* Only on failure */}
      {delivery.mode !== 'none' &&
        delivery.mode !== 'channel' &&
        delivery.mode !== 'desktop' && (
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={delivery.onlyOnFailure ?? false}
              onChange={(e) =>
                onChange({ ...delivery, onlyOnFailure: e.target.checked })
              }
              className="accent-primary size-4 rounded"
              aria-label={t.automation.delivery.onlyOnFailure}
            />
            <span className="text-foreground text-sm">
              {t.automation.delivery.onlyOnFailure}
            </span>
          </label>
        )}
    </div>
  );
}
