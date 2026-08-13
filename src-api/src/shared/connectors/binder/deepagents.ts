import {
  cloneBoundedJsonObject,
  type BoundedJsonObject,
} from '@/shared/connectors/bounded-json';
import type { ConnectorToolDetail } from '@/shared/connectors/catalog';

import { connectorToolDescription } from './anthropic';

const EMPTY_SCHEMA: BoundedJsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

export interface DeepAgentsConnectorTool {
  name: string;
  description: string;
  schema: BoundedJsonObject;
  metadata: {
    connectorTool: true;
    sideEffect: ConnectorToolDetail['safety']['sideEffect'];
    approval: ConnectorToolDetail['safety']['approval'];
  };
}

export function connectorToolToDeepAgentsTool(
  tool: ConnectorToolDetail,
): DeepAgentsConnectorTool {
  return {
    name: tool.name,
    description: connectorToolDescription(tool),
    schema: cloneBoundedJsonObject(tool.inputSchemaJson ?? EMPTY_SCHEMA),
    metadata: {
      connectorTool: true,
      sideEffect: tool.safety.sideEffect,
      approval: tool.safety.approval,
    },
  };
}
