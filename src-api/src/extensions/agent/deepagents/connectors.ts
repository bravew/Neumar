import {
  executeConnectorTool,
  materializeTools,
  type BinderRunContext,
  type ConnectorToolExecutionResult,
  type DeepAgentsConnectorTool,
} from '@/shared/connectors/binder';
import type { ConnectorDetail } from '@/shared/connectors/catalog';

export function materializeDeepAgentsConnectorTools(args: {
  catalog: ConnectorDetail[];
  context: BinderRunContext;
}): DeepAgentsConnectorTool[] {
  return materializeTools({
    catalog: args.catalog,
    context: args.context,
    shape: 'deepagents',
  }) as DeepAgentsConnectorTool[];
}

export async function executeDeepAgentsConnectorTool(args: {
  connectorId: string;
  toolName: string;
  input: unknown;
  context: BinderRunContext;
}): Promise<ConnectorToolExecutionResult> {
  return executeConnectorTool(args);
}
