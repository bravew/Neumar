export type ConnectorStatus =
  | 'available'
  | 'pending'
  | 'connected'
  | 'error'
  | 'disabled';
export type ConnectorProvider = 'composio' | 'native' | 'local';
export type ConnectorToolApproval = 'auto' | 'confirm' | 'disabled';
export type ConnectorToolSideEffect = 'read' | 'write' | 'destructive';

export interface ConnectorToolDetail {
  name: string;
  title: string;
  description?: string;
  safety: {
    sideEffect: ConnectorToolSideEffect;
    approval: ConnectorToolApproval;
    reason?: string;
  };
  refreshEligible: boolean;
  requiredScopes?: string[];
}

export interface ConnectorScopeConnection {
  scopeKey: string;
  label: string;
  accountLabel?: string;
  connectedAccountId?: string;
  status: ConnectorStatus;
}

export interface ConnectorDetail {
  id: string;
  name: string;
  provider: ConnectorProvider;
  category: string;
  description?: string;
  apiKeyUrl?: string;
  status: ConnectorStatus;
  accountLabel?: string;
  scopeConnections?: ConnectorScopeConnection[];
  tools: ConnectorToolDetail[];
  allowedToolNames: string[];
  curatedToolNames: string[];
  toolCount?: number;
  featuredToolNames?: string[];
  lastError?: string;
  auth: {
    provider: 'composio' | 'oauth' | 'apikey' | 'none';
    configured: boolean;
  };
}

export interface ComposioConfig {
  configured: boolean;
  apiKeyTail: string;
}
