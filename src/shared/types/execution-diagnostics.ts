export type DiagnosticSource = 'neuma' | 'agent-runtime' | 'model-provider';
export type DiagnosticEvidence = 'measured' | 'computed' | 'indirect';

export type DiagnosticValue<T> =
  | {
      state: 'available';
      value: T;
      evidence: DiagnosticEvidence;
      source: DiagnosticSource;
      complete?: boolean;
    }
  | {
      state: 'not_collected' | 'unsupported' | 'upstream_unavailable';
      source: DiagnosticSource;
      missingReason: string;
    };

export type TimingPhase =
  | 'prompt_build'
  | 'agent_run'
  | 'model_call'
  | 'tool_call'
  | 'artifact_write'
  | 'preview_verify'
  | 'stream_start_to_end'
  | 'finalize';

export interface ExecutionDiagnosticsV1 {
  schema: 'neuma.execution-diagnostics.v1';
  runId: string;
  mode: 'task' | 'design' | 'video';
  ownerKey: string;
  collectedAt: string;
  eventStreamCompleteness: 'complete' | 'partial';
  timing: Record<TimingPhase, DiagnosticValue<number>>;
  tools: {
    total: DiagnosticValue<number>;
    succeeded: DiagnosticValue<number>;
    failed: DiagnosticValue<number>;
    byName: DiagnosticValue<Record<string, number>>;
  };
  anomalies: Record<
    'approval' | 'hook' | 'error' | 'budget',
    DiagnosticValue<number>
  >;
  usage: {
    inputTokens: DiagnosticValue<number>;
    outputTokens: DiagnosticValue<number>;
    cacheReadTokens: DiagnosticValue<number>;
    cacheCreationTokens: DiagnosticValue<number>;
    costUsd: DiagnosticValue<number>;
  };
  environment: {
    runtimeId: DiagnosticValue<string>;
    runtimeVersion: DiagnosticValue<string>;
    requestedModel: DiagnosticValue<string>;
    resolvedModel: DiagnosticValue<string>;
    attempt: DiagnosticValue<number>;
    continuationAttempts: DiagnosticValue<number>;
  };
  artifactDelivery: {
    producedFileCount: DiagnosticValue<number>;
    verdict: DiagnosticValue<string>;
  };
}
