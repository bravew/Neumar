import { ShortcutSettings } from '@/components/shortcuts/ShortcutSettings';
import { CONNECTOR_PLATFORM_V2_ENABLED } from '@/config';
import { cn } from '@/shared/lib/utils';

import { AboutSettings } from './tabs/AboutSettings';
import { AccountSettings } from './tabs/AccountSettings';
import { AdvancedSettings } from './tabs/AdvancedSettings';
import { AgentRuntimeSettings } from './tabs/AgentRuntimeSettings';
import { ChannelSettings } from './tabs/ChannelSettings';
import { ConnectorsTab } from './tabs/connectors/ConnectorsTab';
import { ConnectorSettings } from './tabs/ConnectorSettings';
import { DataSettings } from './tabs/DataSettings';
import { DesignModeSettings } from './tabs/DesignModeSettings';
import { GeneralSettings } from './tabs/GeneralSettings';
import { HookSettings } from './tabs/HookSettings';
import { MCPSettings } from './tabs/MCPSettings';
import { MemorySettings } from './tabs/MemorySettings';
import { ModelSettings } from './tabs/ModelSettings';
import { ModesSettings } from './tabs/ModesSettings';
import { PermissionSettings } from './tabs/PermissionSettings';
import { PetsSettings } from './tabs/PetsSettings';
import { PluginSettings } from './tabs/PluginSettings';
import { ProfileSettings } from './tabs/ProfileSettings';
import { PublishSettings } from './tabs/PublishSettings';
import { SearchSettings } from './tabs/SearchSettings';
import { SecretsSettings } from './tabs/SecretsSettings';
import { SkillsSettings } from './tabs/SkillsSettings';
import { SpeechSettings } from './tabs/SpeechSettings';
import { ThemeSettings } from './tabs/ThemeSettings';
import { UsageSettings } from './tabs/UsageSettings';
import { WorkplaceSettings } from './tabs/WorkplaceSettings';
import type { SettingsCategory, SettingsType } from './types';

interface SettingsContentProps {
  activeCategory: SettingsCategory;
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
  defaultPaths: {
    workDir: string;
    mcpConfigPath: string;
    skillsPath: string;
  };
}

export function SettingsContent({
  activeCategory,
  settings,
  onSettingsChange,
  defaultPaths,
}: SettingsContentProps) {
  return (
    <div
      data-testid={`settings-content-${activeCategory}`}
      className={cn(
        'min-h-0 flex-1',
        activeCategory === 'model'
          ? 'overflow-hidden'
          : 'overflow-y-auto px-8 py-6',
      )}
    >
      <div
        className={
          activeCategory === 'model'
            ? 'h-full'
            : // Grid-heavy tabs fill the full width so their card grids don't
              // sit in a narrow centered column with large empty side bands.
              activeCategory === 'plugins'
              ? 'w-full'
              : activeCategory === 'usage'
                ? 'mx-auto max-w-6xl'
                : 'mx-auto max-w-3xl'
        }
      >
        {activeCategory === 'account' && (
          <AccountSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'general' && (
          <GeneralSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'workplace' && (
          <WorkplaceSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
            defaultPaths={defaultPaths}
          />
        )}

        {activeCategory === 'model' && (
          <ModelSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'agentRuntimes' && (
          <AgentRuntimeSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'mcp' && (
          <MCPSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'skills' && (
          <SkillsSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'plugins' && <PluginSettings />}

        {activeCategory === 'modes' && (
          <ModesSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'pets' && (
          <PetsSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'designMode' && (
          <DesignModeSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'connector' &&
          (CONNECTOR_PLATFORM_V2_ENABLED ? (
            <ConnectorsTab
              settings={settings}
              onSettingsChange={onSettingsChange}
            />
          ) : (
            <ConnectorSettings
              settings={settings}
              onSettingsChange={onSettingsChange}
            />
          ))}

        {activeCategory === 'channels' && (
          <ChannelSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'memory' && <MemorySettings />}

        {activeCategory === 'speech' && (
          <SpeechSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'search' && (
          <SearchSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'keyboard' && <ShortcutSettings />}

        {activeCategory === 'publish' && (
          <PublishSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'usage' && <UsageSettings />}

        {activeCategory === 'data' && <DataSettings />}

        {activeCategory === 'advanced' && <AdvancedSettings />}

        {activeCategory === 'about' && <AboutSettings />}

        {activeCategory === 'theme' && <ThemeSettings />}

        {activeCategory === 'profiles' && <ProfileSettings />}

        {activeCategory === 'permissions' && (
          <PermissionSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'hooks' && (
          <HookSettings
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}

        {activeCategory === 'secrets' && <SecretsSettings />}
      </div>
    </div>
  );
}
