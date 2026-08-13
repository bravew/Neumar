import { useCallback, useEffect, useState } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';

import { CloudStorageConnectionsSection } from '../../cloud-storage/CloudStorageConnectionsSection';
import { ConnectorAccessControls } from '../../ConnectorAccessControls';
import { GoogleWorkspaceSection } from '../../GoogleWorkspaceSection';
import type { SettingsTabProps } from '../../types';
import { AccessPolicySection } from './AccessPolicySection';
import { ComposioApiKeyCard } from './ComposioApiKeyCard';
import { ComposioSection } from './ComposioSection';
import { ConnectorCatalogGrid } from './ConnectorCatalogGrid';
import { ConnectorDetailDrawer } from './ConnectorDetailDrawer';
import { useComposioConfig } from './hooks/useComposioConfig';
import { useConnectorCatalog } from './hooks/useConnectorCatalog';

const GOOGLE_WORKSPACE_CONNECTOR_IDS = [
  'gmail',
  'drive',
  'calendar',
  'gmail_composio',
  'drive_composio',
  'calendar_composio',
  'googledocs',
  'googlesheets',
  'googleslides',
  'googleforms',
  'googlephotos',
  'googlemeet',
  'googlecontacts',
] as const;

export function ConnectorsTab(_props: SettingsTabProps) {
  const { t } = useLanguage();
  const messages = t.connectors;
  const composio = useComposioConfig();
  const catalog = useConnectorCatalog();
  const saveComposioConfig = composio.save;
  const refreshCatalog = catalog.refresh;
  const [openId, setOpenId] = useState<string | null>(null);

  const handleSaveComposioKey = useCallback(
    async (apiKey: string | null) => {
      await saveComposioConfig(apiKey);
      // Catalog re-discovery is driven by the useEffect below — it fires
      // whenever `configured` flips, including the save-time flip and the
      // initial mount with persisted config. Doing it here would mean two
      // back-to-back /connectors/discovery calls.
    },
    [saveComposioConfig],
  );

  useEffect(() => {
    if (!composio.config.configured) return;
    void refreshCatalog();
  }, [refreshCatalog, composio.config.configured]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{messages.title}</h1>
        <p className="text-muted-foreground text-sm">{messages.subtitle}</p>
      </div>
      <section className="space-y-3">
        <SectionGroupHeading
          title={messages.groupYourAccounts}
          description={messages.groupYourAccountsDescription}
        />
        <GoogleWorkspaceSection />
        <CloudStorageConnectionsSection />
      </section>

      <section className="space-y-3">
        <SectionGroupHeading
          title={messages.groupCatalog}
          description={messages.groupCatalogDescription}
        />
        <ComposioSection
          count={
            catalog.connectors?.filter((c) => c.status === 'connected').length
          }
        >
          <ComposioApiKeyCard
            messages={messages}
            config={composio.config}
            saving={composio.saving}
            error={composio.error}
            onSave={handleSaveComposioKey}
            onRefreshCatalog={refreshCatalog}
          />
          <ConnectorCatalogGrid
            catalog={catalog}
            messages={messages}
            hiddenConnectorIds={GOOGLE_WORKSPACE_CONNECTOR_IDS}
            onOpen={setOpenId}
          />
        </ComposioSection>
      </section>

      <section className="space-y-3">
        <SectionGroupHeading
          title={messages.groupGovernance}
          description={messages.groupGovernanceDescription}
        />
        <AccessPolicySection>
          <ConnectorAccessControls />
        </AccessPolicySection>
      </section>

      <ConnectorDetailDrawer
        connectorId={openId}
        messages={messages}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function SectionGroupHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-1">
      <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      <p className="text-muted-foreground text-xs">{description}</p>
    </div>
  );
}
