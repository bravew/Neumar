/**
 * A2A Protocol Types (RC v1.0)
 *
 * Agent-to-Agent protocol types based on the A2A Specification RC v1.0.
 * A2A is the standard for agent-to-agent communication under the
 * Agentic AI Foundation (AAIF).
 */

/** A2A Agent Card — discoverable at /.well-known/agent-card.json */
export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags?: string[];
  }>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

/** A2A Task lifecycle states (RC v1.0 — prefixed constants) */
export const A2ATaskState = {
  SUBMITTED: 'TASK_STATE_SUBMITTED',
  WORKING: 'TASK_STATE_WORKING',
  INPUT_REQUIRED: 'TASK_STATE_INPUT_REQUIRED',
  AUTH_REQUIRED: 'TASK_STATE_AUTH_REQUIRED',
  COMPLETED: 'TASK_STATE_COMPLETED',
  FAILED: 'TASK_STATE_FAILED',
  CANCELED: 'TASK_STATE_CANCELED',
  REJECTED: 'TASK_STATE_REJECTED',
} as const;
export type A2ATaskStateValue =
  (typeof A2ATaskState)[keyof typeof A2ATaskState];

/** A2A Task — the unit of work between agents */
export interface A2ATask {
  id: string;
  sessionId?: string;
  status: {
    state: A2ATaskStateValue;
    message?: A2AMessage;
    timestamp: string;
  };
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
}

/** A2A Message */
export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
}

export type A2APart =
  | { type: 'text'; text: string }
  | {
      type: 'file';
      file: {
        name: string;
        mimeType: string;
        bytes?: string;
        uri?: string;
      };
    }
  | { type: 'data'; data: Record<string, unknown> };

/** A2A Artifact — output from agent work */
export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index: number;
  append?: boolean;
  lastChunk?: boolean;
}

/** A2A JSON-RPC method names (RC v1.0 — PascalCase) */
export const A2AMethods = {
  SEND_MESSAGE: 'SendMessage',
  SEND_STREAMING_MESSAGE: 'SendStreamingMessage',
  GET_TASK: 'GetTask',
  LIST_TASKS: 'ListTasks',
  CANCEL_TASK: 'CancelTask',
  SUBSCRIBE_TO_TASK: 'SubscribeToTask',
  GET_EXTENDED_AGENT_CARD: 'GetExtendedAgentCard',
} as const;

/** JSON-RPC 2.0 request */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** A2A stream event (SSE) */
export type A2AStreamEvent =
  | { type: 'status'; task: A2ATask }
  | { type: 'artifact'; artifact: A2AArtifact; taskId: string }
  | { type: 'done'; taskId: string };
