import type { AgentRuntimeStatus } from './types.js';

export type RuntimeConnectionTestStatus =
  | 'ok'
  | 'not_installed'
  | 'auth_required'
  | 'incompatible_version'
  | 'unsupported_model'
  | 'protocol_failure'
  | 'permission_failure'
  | 'unknown';

export type RuntimeConnectionRecoveryIntent =
  | 'install'
  | 'update'
  | 'authenticate'
  | 'inspect_diagnostics';

export interface RuntimeConnectionRecoveryAction {
  intent: RuntimeConnectionRecoveryIntent;
  label: string;
  optionId?: string;
  commandHash?: string;
  rendered?: string;
  inAppRunnable?: boolean;
  detail?: string;
}

export interface RuntimeConnectionTestResult {
  ok: boolean;
  status: RuntimeConnectionTestStatus;
  message: string;
  runtime: AgentRuntimeStatus;
  recoveryActions?: RuntimeConnectionRecoveryAction[];
}

/**
 * Diagnostics that mean the runtime's headless auth is missing even when the
 * auth probe reported ok/unknown — e.g. `cursor-agent models` failing with
 * "Authentication required" while `cursor-agent status` claims a login.
 */
const AUTH_REQUIRED_DIAGNOSTIC_RE =
  /authentication required|not (logged|signed) in|unauthenticated|please (log|sign) in|login required/i;
const UNSUPPORTED_MODEL_RE =
  /Model "[^"]+" is not a recognized model id\.|unsupported model|unknown model/i;
const INCOMPATIBLE_VERSION_RE =
  /requires .*v?\d+\.\d+|incompatible version|upgrade required/i;
const PROTOCOL_FAILURE_RE =
  /protocol|json-rpc|malformed frame|initialize failed/i;
const PERMISSION_FAILURE_RE =
  /permission denied|permission failure|not permitted/i;

function authRequiredDiagnostic(
  runtime: AgentRuntimeStatus,
): string | undefined {
  return runtime.diagnostics?.find(
    (item) =>
      (item.level === 'warn' || item.level === 'error') &&
      AUTH_REQUIRED_DIAGNOSTIC_RE.test(item.message),
  )?.message;
}

function diagnosticHint(runtime: AgentRuntimeStatus): string {
  const diagnostic = runtime.diagnostics?.find(
    (item) => item.level === 'warn' || item.level === 'error',
  );
  return diagnostic ? ` ${diagnostic.message}` : '';
}

function firstDiagnostic(runtime: AgentRuntimeStatus): string | undefined {
  return runtime.diagnostics?.find(
    (item) => item.level === 'warn' || item.level === 'error',
  )?.message;
}

function optionRecoveryAction(
  intent: 'install' | 'update',
  option: NonNullable<AgentRuntimeStatus['install']>[number],
): RuntimeConnectionRecoveryAction {
  return {
    intent,
    label: option.label,
    optionId: option.id,
    commandHash: option.commandHash,
    rendered: option.rendered,
    inAppRunnable: option.inAppRunnable,
    detail: option.notes,
  };
}

function appendRecoveryHint(
  message: string,
  actions: RuntimeConnectionRecoveryAction[],
): string {
  const first = actions[0];
  if (!first) return message;
  const punctuation = /[.!?]$/.test(first.label.trim()) ? '' : '.';
  return `${message} Suggested action: ${first.label}${punctuation}`;
}

function connectionRecoveryActions(
  runtime: AgentRuntimeStatus,
): RuntimeConnectionRecoveryAction[] {
  if (!runtime.available) {
    return (runtime.install ?? []).map((option) =>
      optionRecoveryAction('install', option),
    );
  }

  const authDiagnostic = authRequiredDiagnostic(runtime);
  if (runtime.auth?.state === 'unauthenticated' || authDiagnostic) {
    // Only trust auth.detail when the probe itself said unauthenticated —
    // on a diagnostic-driven flip the probe's detail is a stale success.
    const probeDetail =
      runtime.auth?.state === 'unauthenticated'
        ? runtime.auth.detail
        : undefined;
    return [
      {
        intent: 'authenticate',
        label:
          probeDetail ??
          `Run \`${runtime.bin} login\` in a terminal, then rescan.`,
        detail: probeDetail ?? authDiagnostic,
      },
    ];
  }

  const diagnostic = firstDiagnostic(runtime);
  if (!diagnostic) return [];

  const updateActions = (runtime.update ?? []).map((option) =>
    optionRecoveryAction('update', option),
  );
  return [
    ...updateActions,
    {
      intent: 'inspect_diagnostics',
      label: 'Inspect diagnostics',
      detail: diagnostic,
    },
  ];
}

export function buildRuntimeConnectionTestResult(
  runtime: AgentRuntimeStatus,
): RuntimeConnectionTestResult {
  const hint = diagnosticHint(runtime);
  const recoveryActions = connectionRecoveryActions(runtime);

  if (!runtime.available) {
    return {
      ok: false,
      status: 'not_installed',
      message: appendRecoveryHint(
        `${runtime.name} is not installed or could not be found.${hint}`,
        recoveryActions,
      ),
      runtime,
      ...(recoveryActions.length > 0 ? { recoveryActions } : {}),
    };
  }

  const authDiagnostic = authRequiredDiagnostic(runtime);
  if (runtime.auth?.state === 'unauthenticated' || authDiagnostic) {
    const probeDetail =
      runtime.auth?.state === 'unauthenticated'
        ? runtime.auth.detail
        : undefined;
    const baseMessage = probeDetail
      ? `${probeDetail}${hint}`
      : `${runtime.name} is installed but not authenticated.${hint}`;
    return {
      ok: false,
      status: 'auth_required',
      message: appendRecoveryHint(baseMessage, recoveryActions),
      runtime,
      ...(recoveryActions.length > 0 ? { recoveryActions } : {}),
    };
  }

  const failureDiagnostic = firstDiagnostic(runtime);
  const classifiedStatus = failureDiagnostic
    ? UNSUPPORTED_MODEL_RE.test(failureDiagnostic)
      ? 'unsupported_model'
      : INCOMPATIBLE_VERSION_RE.test(failureDiagnostic)
        ? 'incompatible_version'
        : PERMISSION_FAILURE_RE.test(failureDiagnostic)
          ? 'permission_failure'
          : PROTOCOL_FAILURE_RE.test(failureDiagnostic)
            ? 'protocol_failure'
            : null
    : null;
  if (classifiedStatus) {
    return {
      ok: false,
      status: classifiedStatus,
      message: failureDiagnostic!,
      runtime,
      ...(recoveryActions.length > 0 ? { recoveryActions } : {}),
    };
  }

  if (runtime.auth?.state === 'unknown') {
    return {
      ok: true,
      status: 'unknown',
      message: appendRecoveryHint(
        `${runtime.name} is installed. Authentication status is unknown.${hint}`,
        recoveryActions,
      ),
      runtime,
      ...(recoveryActions.length > 0 ? { recoveryActions } : {}),
    };
  }

  return {
    ok: true,
    status: 'ok',
    message: appendRecoveryHint(
      `${runtime.name} is installed and ready.${hint}`,
      recoveryActions,
    ),
    runtime,
    ...(recoveryActions.length > 0 ? { recoveryActions } : {}),
  };
}
