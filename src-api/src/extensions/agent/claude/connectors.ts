import {
  executeConnectorTool,
  materializeTools,
  type AnthropicConnectorTool,
  type BinderRunContext,
  type ConnectorToolExecutionResult,
} from '@/shared/connectors/binder';
import type { ConnectorDetail } from '@/shared/connectors/catalog';

export function materializeClaudeConnectorTools(args: {
  catalog: ConnectorDetail[];
  context: BinderRunContext;
}): AnthropicConnectorTool[] {
  return materializeTools({
    catalog: args.catalog,
    context: args.context,
    shape: 'anthropic',
  }) as AnthropicConnectorTool[];
}

export async function executeClaudeConnectorTool(args: {
  connectorId: string;
  toolName: string;
  input: unknown;
  context: BinderRunContext;
}): Promise<ConnectorToolExecutionResult> {
  return executeConnectorTool(args);
}
