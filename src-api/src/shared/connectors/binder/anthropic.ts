import {
  cloneBoundedJsonObject,
  type BoundedJsonObject,
} from '@/shared/connectors/bounded-json';
import type { ConnectorToolDetail } from '@/shared/connectors/catalog';

const EMPTY_INPUT_SCHEMA: BoundedJsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

export interface AnthropicConnectorTool {
  name: string;
  description: string;
  input_schema: BoundedJsonObject;
}

export function connectorToolToAnthropicTool(
  tool: ConnectorToolDetail,
): AnthropicConnectorTool {
  return {
    name: tool.name,
    description: connectorToolDescription(tool),
    input_schema: cloneBoundedJsonObject(
      tool.inputSchemaJson ?? EMPTY_INPUT_SCHEMA,
    ),
  };
}

export function connectorToolDescription(tool: ConnectorToolDetail): string {
  const base = tool.description || tool.title || tool.name;
  return tool.safety.approval === 'confirm'
    ? `${base} [needs confirmation]`
    : base;
}
