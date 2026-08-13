import type { ChatCompletionTool } from 'openai/resources/chat/completions';

import {
  cloneBoundedJsonObject,
  type BoundedJsonObject,
} from '@/shared/connectors/bounded-json';
import type { ConnectorToolDetail } from '@/shared/connectors/catalog';

import { connectorToolDescription } from './anthropic';

const EMPTY_PARAMETERS: BoundedJsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

export type OpenAIConnectorTool = ChatCompletionTool;

export function connectorToolToOpenAITool(
  tool: ConnectorToolDetail,
): OpenAIConnectorTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: connectorToolDescription(tool),
      parameters: cloneBoundedJsonObject(
        tool.inputSchemaJson ?? EMPTY_PARAMETERS,
      ),
    },
  };
}
