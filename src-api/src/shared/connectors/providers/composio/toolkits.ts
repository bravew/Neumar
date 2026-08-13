export interface ComposioToolkitMetadata {
  connectorId: string;
  toolkitSlug: string;
  logoSlug: string;
  category: string;
  recommended: boolean;
}

export const COMPOSIO_TOOLKITS: ComposioToolkitMetadata[] = [
  {
    connectorId: 'github',
    toolkitSlug: 'github',
    logoSlug: 'github',
    category: 'Engineering',
    recommended: true,
  },
  {
    connectorId: 'linear',
    toolkitSlug: 'linear',
    logoSlug: 'linear',
    category: 'Product',
    recommended: true,
  },
  {
    connectorId: 'stripe',
    toolkitSlug: 'stripe',
    logoSlug: 'stripe',
    category: 'Finance',
    recommended: true,
  },
  {
    connectorId: 'notion_composio',
    toolkitSlug: 'notion',
    logoSlug: 'notion',
    category: 'Knowledge',
    recommended: false,
  },
  {
    connectorId: 'slack_composio',
    toolkitSlug: 'slack',
    logoSlug: 'slack',
    category: 'Communication',
    recommended: false,
  },
  {
    connectorId: 'gmail_composio',
    toolkitSlug: 'gmail',
    logoSlug: 'gmail',
    category: 'Google Workspace',
    recommended: false,
  },
  {
    connectorId: 'drive_composio',
    toolkitSlug: 'googledrive',
    logoSlug: 'google_drive',
    category: 'Google Workspace',
    recommended: false,
  },
  {
    connectorId: 'calendar_composio',
    toolkitSlug: 'googlecalendar',
    logoSlug: 'google_calendar',
    category: 'Google Workspace',
    recommended: false,
  },
  {
    connectorId: 'jira',
    toolkitSlug: 'jira',
    logoSlug: 'jira',
    category: 'Product',
    recommended: false,
  },
  {
    connectorId: 'confluence',
    toolkitSlug: 'confluence',
    logoSlug: 'confluence',
    category: 'Knowledge',
    recommended: false,
  },
  {
    connectorId: 'hubspot',
    toolkitSlug: 'hubspot',
    logoSlug: 'hubspot',
    category: 'CRM',
    recommended: false,
  },
  {
    connectorId: 'salesforce',
    toolkitSlug: 'salesforce',
    logoSlug: 'salesforce',
    category: 'CRM',
    recommended: false,
  },
  {
    connectorId: 'zendesk',
    toolkitSlug: 'zendesk',
    logoSlug: 'zendesk',
    category: 'Support',
    recommended: false,
  },
  {
    connectorId: 'airtable',
    toolkitSlug: 'airtable',
    logoSlug: 'airtable',
    category: 'Database',
    recommended: false,
  },
  {
    connectorId: 'asana',
    toolkitSlug: 'asana',
    logoSlug: 'asana',
    category: 'Project Management',
    recommended: false,
  },
  {
    connectorId: 'trello',
    toolkitSlug: 'trello',
    logoSlug: 'trello',
    category: 'Project Management',
    recommended: false,
  },
  {
    connectorId: 'monday',
    toolkitSlug: 'monday',
    logoSlug: 'monday',
    category: 'Project Management',
    recommended: false,
  },
  // Box / Dropbox / OneDrive intentionally NOT routed through Composio.
  // Cloud-storage connectors use first-party OAuth (see
  // src-api/src/shared/integrations/cloud-storage/providers/) so the agent
  // can call provider APIs directly with a real bearer token instead of
  // going through Composio's tool-execute shim (which masks credentials).
  {
    connectorId: 'figma',
    toolkitSlug: 'figma',
    logoSlug: 'figma',
    category: 'Design',
    recommended: false,
  },
];

export function getToolkitSlugForConnector(connectorId: string): string | null {
  return (
    COMPOSIO_TOOLKITS.find((toolkit) => toolkit.connectorId === connectorId)
      ?.toolkitSlug ?? null
  );
}
