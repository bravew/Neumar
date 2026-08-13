import { useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { AuditTab } from './AuditTab';
import { ConfigTab } from './ConfigTab';
import type { PanelTab, Platform, PlatformConfig } from './types';
import { UsersTab } from './UsersTab';

interface PlatformPanelProps {
  platform: Platform;
  configId: string;
  config: PlatformConfig;
  onSave: (
    creds: Record<string, string>,
    cfg: Partial<PlatformConfig>,
  ) => Promise<void>;
  onTest: (creds: Record<string, string>) => Promise<void>;
  saving: boolean;
  testing: boolean;
  testResult: { valid: boolean; error?: string } | null;
}

export function PlatformPanel({
  platform,
  configId,
  config,
  onSave,
  onTest,
  saving,
  testing,
  testResult,
}: PlatformPanelProps) {
  const { t } = useLanguage();
  const s = t.settings;
  const [activeTab, setActiveTab] = useState<PanelTab>('config');

  const tabs: { key: PanelTab; label: string }[] = [
    { key: 'config', label: s?.channelConfiguration ?? 'Configuration' },
    { key: 'users', label: s?.channelUsers ?? 'Users' },
    { key: 'audit', label: s?.channelAuditLog ?? 'Audit Log' },
  ];

  return (
    <div className="border-border border-t">
      {/* Sub-tabs */}
      <div className="border-border flex gap-0 border-b px-4">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={cn(
              'cursor-pointer px-3 py-2 text-xs font-medium transition-colors',
              activeTab === key
                ? 'border-foreground text-foreground -mb-px border-b-2'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-3">
        {activeTab === 'config' && (
          <ConfigTab
            platform={platform}
            config={config}
            onSave={onSave}
            onTest={onTest}
            saving={saving}
            testing={testing}
            testResult={testResult}
          />
        )}
        {activeTab === 'users' && <UsersTab configId={configId} />}
        {activeTab === 'audit' && <AuditTab configId={configId} />}
      </div>
    </div>
  );
}
