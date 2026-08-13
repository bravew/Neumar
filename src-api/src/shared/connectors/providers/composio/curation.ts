import type { ConnectorToolCuration } from '@/shared/connectors/catalog';

export const COMPOSIO_CURATION_OVERLAY: Record<string, ConnectorToolCuration> =
  {
    'github.github_search_repositories': {
      useCases: ['agent_tooling', 'design_mode_refresh'],
      reason:
        'Read-only repository discovery is useful for agent context and refresh.',
    },
    'linear.linear_get_issue': {
      useCases: ['agent_tooling', 'design_mode_refresh'],
    },
    'stripe.stripe_list_customers': {
      useCases: ['agent_tooling'],
    },
  };
