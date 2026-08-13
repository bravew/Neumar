import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';
import { ChannelFallbackDiagnostics } from './channel/ChannelFallbackDiagnostics';
import { GatewayChannelList } from './channel/GatewayChannelList';
import { PlatformSection } from './channel/PlatformSection';
import { RoutingRulesTable } from './channel/RoutingRulesTable';
import { PLATFORMS, type Platform, type PlatformConfig } from './channel/types';
import { useChannelActions } from './channel/useChannelActions';

export function ChannelSettings(_props: SettingsTabProps) {
  const { t } = useLanguage();
  const s = t.settings;
  const actions = useChannelActions();

  const configsByPlatform = useMemo(
    () =>
      PLATFORMS.reduce(
        (acc, p) => {
          acc[p] = actions.configs.filter((c) => c.platform === p);
          return acc;
        },
        {} as Record<Platform, PlatformConfig[]>,
      ),
    [actions.configs],
  );

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        {s?.channelEnabledDesc ??
          'Configure and connect Telegram, Lark, Discord, or Slack bots to run the agent remotely.'}
      </p>

      <div className="border-border divide-border divide-y rounded-lg border">
        {PLATFORMS.map((platform) => (
          <PlatformSection
            key={platform}
            platform={platform}
            configs={configsByPlatform[platform]}
            statuses={actions.statuses}
            expanded={actions.expanded}
            saving={actions.saving}
            starting={actions.starting}
            testing={actions.testing}
            startErrors={actions.startErrors}
            testResults={actions.testResults}
            botError={actions.botErrors[platform]}
            onAddBot={actions.handleAddBot}
            onToggleExpanded={(configId) =>
              actions.setExpanded((prev) =>
                prev === configId ? null : configId,
              )
            }
            onTest={actions.handleTest}
            onToggleRunning={(configId) =>
              actions.handleToggleRunning(configId)
            }
            onRequestDelete={actions.setPendingDeleteId}
            onSave={actions.handleSave}
          />
        ))}
      </div>

      {/* Gateway adapters — Feishu / iMessage / Linear / WhatsApp / SMS */}
      <GatewayChannelList />

      {/* Routing rules drive (workspace, channel, intent, chat) → profile */}
      <RoutingRulesTable />

      <ChannelFallbackDiagnostics />

      <Dialog
        open={!!actions.pendingDeleteId}
        onOpenChange={(open) => !open && actions.setPendingDeleteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s?.channelDeleteBot ?? 'Delete bot'}</DialogTitle>
            <DialogDescription>
              {s?.channelDeleteBotConfirm ??
                'Delete this bot configuration? This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => actions.setPendingDeleteId(null)}
            >
              {t.common.cancel ?? 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                actions.pendingDeleteId &&
                actions.handleDeleteBot(actions.pendingDeleteId)
              }
            >
              {t.common.delete ?? 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
