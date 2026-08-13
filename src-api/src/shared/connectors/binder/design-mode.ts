import type { BoundedJsonObject } from '@/shared/connectors/bounded-json';
import type {
  ConnectorDetail,
  ConnectorToolApproval,
  ConnectorToolSideEffect,
} from '@/shared/connectors/catalog';

import {
  materializeConnectorToolEntries,
  type BinderRunContext,
  type ConnectorBinderPolicy,
} from './index';

export interface DesignModeConnectorTool {
  connectorId: string;
  connectorName: string;
  accountLabel?: string;
  toolName: string;
  title: string;
  description?: string;
  inputSchemaJson?: BoundedJsonObject;
  safety: {
    sideEffect: ConnectorToolSideEffect;
    approval: ConnectorToolApproval;
  };
}

export interface DesignModeConnectorList {
  tools: DesignModeConnectorTool[];
}

export function listDesignModeConnectorTools(args: {
  catalog: ConnectorDetail[];
  context: BinderRunContext;
  policy?: ConnectorBinderPolicy;
}): DesignModeConnectorList {
  const entries = materializeConnectorToolEntries({
    catalog: args.catalog,
    context: {
      ...args.context,
      surface: 'design_mode',
    },
    policy: args.policy,
  });

  return {
    tools: entries.map(({ connector, tool }) => ({
      connectorId: connector.id,
      connectorName: connector.name,
      accountLabel: connector.accountLabel,
      toolName: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchemaJson: tool.inputSchemaJson,
      safety: {
        sideEffect: tool.safety.sideEffect,
        approval: tool.safety.approval,
      },
    })),
  };
}
