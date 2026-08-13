import {
  connectorDefinitionToDetail,
  defineConnectorTool,
  type ConnectorCatalogDefinition,
  type ConnectorDetail,
} from './catalog';

const EMPTY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

export const RECOMMENDED_CONNECTOR_IDS = [
  'github',
  'notion',
  'linear',
  'slack',
  'stripe',
  'gmail',
  'drive',
  'calendar',
] as const;

const API_KEY_URLS = {
  github: 'https://github.com/settings/personal-access-tokens',
  notion: 'https://www.notion.so/my-integrations',
  linear: 'https://linear.app/settings/api',
  slack: 'https://api.slack.com/apps',
  stripe: 'https://dashboard.stripe.com/apikeys',
  google: 'https://console.cloud.google.com/apis/credentials',
} as const;

export const CONNECTOR_SEED_CATALOG: ConnectorCatalogDefinition[] = [
  {
    id: 'github',
    name: 'GitHub',
    provider: 'composio',
    providerConnectorId: 'github',
    category: 'Engineering',
    description:
      'Search repositories, issues, pull requests, and project metadata.',
    apiKeyUrl: API_KEY_URLS.github,
    authentication: 'composio',
    allowedToolNames: [
      'github.github_search_repositories',
      'github.github_list_issues',
      'github.github_create_issue',
    ],
    curatedToolNames: [
      'github.github_search_repositories',
      'github.github_list_issues',
      'github.github_create_issue',
    ],
    featuredToolNames: ['github.github_search_repositories'],
    toolCount: 3,
    tools: [
      defineConnectorTool({
        name: 'github.github_search_repositories',
        title: 'Search repositories',
        description:
          'Search GitHub repositories visible to the connected account.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['repo:read'],
      }),
      defineConnectorTool({
        name: 'github.github_list_issues',
        title: 'List issues',
        description: 'List issues for a repository.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['issues:read'],
      }),
      defineConnectorTool({
        name: 'github.github_create_issue',
        title: 'Create issue',
        description: 'Create a new issue in a repository.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['issues:write'],
      }),
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    provider: 'native',
    providerConnectorId: 'notion',
    category: 'Knowledge',
    description: 'Read and update workspace pages through Neuma native OAuth.',
    apiKeyUrl: API_KEY_URLS.notion,
    authentication: 'oauth',
    allowedToolNames: ['notion.search_pages', 'notion.create_page'],
    curatedToolNames: ['notion.search_pages', 'notion.create_page'],
    featuredToolNames: ['notion.search_pages'],
    toolCount: 2,
    tools: [
      defineConnectorTool({
        name: 'notion.search_pages',
        title: 'Search pages',
        description:
          'Search Notion pages available to the connected workspace.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['read_content'],
      }),
      defineConnectorTool({
        name: 'notion.create_page',
        title: 'Create page',
        description:
          'Create a Notion page in a selected database or parent page.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['insert_content'],
      }),
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    provider: 'composio',
    providerConnectorId: 'linear',
    category: 'Product',
    description: 'Search issues and create planning artifacts in Linear.',
    apiKeyUrl: API_KEY_URLS.linear,
    authentication: 'composio',
    allowedToolNames: ['linear.linear_get_issue', 'linear.linear_create_issue'],
    curatedToolNames: ['linear.linear_get_issue', 'linear.linear_create_issue'],
    featuredToolNames: ['linear.linear_get_issue'],
    toolCount: 2,
    tools: [
      defineConnectorTool({
        name: 'linear.linear_get_issue',
        title: 'Get issue',
        description: 'Get a Linear issue by id or key.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['issues:read'],
      }),
      defineConnectorTool({
        name: 'linear.linear_create_issue',
        title: 'Create issue',
        description: 'Create a Linear issue.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['issues:write'],
      }),
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    provider: 'native',
    providerConnectorId: 'slack',
    category: 'Communication',
    description:
      'Search and post Slack messages through Neuma channel routing.',
    apiKeyUrl: API_KEY_URLS.slack,
    authentication: 'oauth',
    allowedToolNames: ['slack.search_messages', 'slack.post_message'],
    curatedToolNames: ['slack.search_messages', 'slack.post_message'],
    featuredToolNames: ['slack.search_messages'],
    toolCount: 2,
    tools: [
      defineConnectorTool({
        name: 'slack.search_messages',
        title: 'Search messages',
        description:
          'Search Slack messages visible to the configured bot or user.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['search:read'],
      }),
      defineConnectorTool({
        name: 'slack.post_message',
        title: 'Post message',
        description: 'Post a message into an approved Slack channel.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['chat:write'],
      }),
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    provider: 'composio',
    providerConnectorId: 'stripe',
    category: 'Finance',
    description: 'Inspect customers, subscriptions, invoices, and payments.',
    apiKeyUrl: API_KEY_URLS.stripe,
    authentication: 'composio',
    allowedToolNames: ['stripe.stripe_list_customers'],
    curatedToolNames: ['stripe.stripe_list_customers'],
    featuredToolNames: ['stripe.stripe_list_customers'],
    toolCount: 1,
    tools: [
      defineConnectorTool({
        name: 'stripe.stripe_list_customers',
        title: 'List customers',
        description: 'List Stripe customers for account review.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['customers:read'],
      }),
    ],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    provider: 'native',
    providerConnectorId: 'gmail',
    category: 'Google Workspace',
    description:
      'Search, read, and draft mail through the native Google adapter.',
    apiKeyUrl: API_KEY_URLS.google,
    authentication: 'oauth',
    allowedToolNames: ['gmail.search_messages', 'gmail.send_message'],
    curatedToolNames: ['gmail.search_messages', 'gmail.send_message'],
    featuredToolNames: ['gmail.search_messages'],
    toolCount: 2,
    tools: [
      defineConnectorTool({
        name: 'gmail.search_messages',
        title: 'Search messages',
        description: 'Search Gmail messages for the connected Google account.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['gmail.readonly'],
      }),
      defineConnectorTool({
        name: 'gmail.send_message',
        title: 'Send message',
        description: 'Send an email message from the connected Google account.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['gmail.send'],
      }),
    ],
  },
  {
    id: 'drive',
    name: 'Google Drive',
    provider: 'native',
    providerConnectorId: 'googledrive',
    category: 'Google Workspace',
    description:
      'Find and inspect files through the native Google Drive adapter.',
    apiKeyUrl: API_KEY_URLS.google,
    authentication: 'oauth',
    allowedToolNames: ['drive.list_files', 'drive.search_files'],
    curatedToolNames: ['drive.list_files', 'drive.search_files'],
    featuredToolNames: ['drive.list_files'],
    toolCount: 2,
    tools: [
      defineConnectorTool({
        name: 'drive.list_files',
        title: 'List files',
        description:
          'List Google Drive files visible to the connected account.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['drive.readonly'],
      }),
      defineConnectorTool({
        name: 'drive.search_files',
        title: 'Search files',
        description: 'Search Google Drive files by query.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['drive.readonly'],
      }),
    ],
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    provider: 'native',
    providerConnectorId: 'googlecalendar',
    category: 'Google Workspace',
    description: 'Read and create calendar events through native Google OAuth.',
    apiKeyUrl: API_KEY_URLS.google,
    authentication: 'oauth',
    allowedToolNames: ['calendar.list_events', 'calendar.create_event'],
    curatedToolNames: ['calendar.list_events', 'calendar.create_event'],
    featuredToolNames: ['calendar.list_events'],
    toolCount: 2,
    tools: [
      defineConnectorTool({
        name: 'calendar.list_events',
        title: 'List events',
        description: 'List Google Calendar events for the connected account.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['calendar.events.readonly'],
      }),
      defineConnectorTool({
        name: 'calendar.create_event',
        title: 'Create event',
        description: 'Create a Google Calendar event.',
        inputSchemaJson: EMPTY_SCHEMA,
        requiredScopes: ['calendar.events'],
      }),
    ],
  },
];

export function getConnectorCatalogDefinitions(): ConnectorCatalogDefinition[] {
  return CONNECTOR_SEED_CATALOG.map((definition) => ({
    ...definition,
    allowedToolNames: [...definition.allowedToolNames],
    curatedToolNames: definition.curatedToolNames
      ? [...definition.curatedToolNames]
      : undefined,
    tools: definition.tools.map((tool) => ({
      ...tool,
      requiredScopes: [...tool.requiredScopes],
      safety: { ...tool.safety },
    })),
  }));
}

export function getConnectorDefinition(
  connectorId: string,
): ConnectorCatalogDefinition | undefined {
  return getConnectorCatalogDefinitions().find(
    (definition) => definition.id === connectorId,
  );
}

export function hasConnectorDefinition(connectorId: string): boolean {
  return CONNECTOR_SEED_CATALOG.some(
    (definition) => definition.id === connectorId,
  );
}

export function getConnectorSeedDetails(): ConnectorDetail[] {
  return getConnectorCatalogDefinitions().map((definition) =>
    connectorDefinitionToDetail(definition),
  );
}
