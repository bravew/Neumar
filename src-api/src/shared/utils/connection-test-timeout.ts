import { createLogger } from '@/shared/utils/logger';

export const NODE_SETTIMEOUT_MAX = 2_147_483_647;
export const DEFAULT_PROVIDER_CONNECTION_TEST_TIMEOUT_MS = 12_000;
export const DEFAULT_AGENT_CONNECTION_TEST_TIMEOUT_MS = 45_000;

type TimeoutLogger = Pick<ReturnType<typeof createLogger>, 'warn'>;

const logger = createLogger('ConnectionTest');

export function resolveConnectionTestTimeoutMs(
  envValue: string | undefined,
  fallback: number,
  log: TimeoutLogger = logger,
): number {
  if (envValue === undefined || envValue === '') return fallback;
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    log.warn(
      `invalid timeout override "${envValue}"; using default ${fallback}ms`,
    );
    return fallback;
  }
  if (parsed > NODE_SETTIMEOUT_MAX) {
    log.warn(
      `timeout override exceeds setTimeout maximum; clamping to ${NODE_SETTIMEOUT_MAX}ms`,
    );
    return NODE_SETTIMEOUT_MAX;
  }
  return parsed;
}

export const PROVIDER_CONNECTION_TEST_TIMEOUT_MS =
  resolveConnectionTestTimeoutMs(
    process.env.DESIGNMODE_CONNECTION_TEST_PROVIDER_TIMEOUT_MS,
    DEFAULT_PROVIDER_CONNECTION_TEST_TIMEOUT_MS,
  );

export const AGENT_CONNECTION_TEST_TIMEOUT_MS = resolveConnectionTestTimeoutMs(
  process.env.DESIGNMODE_CONNECTION_TEST_AGENT_TIMEOUT_MS,
  DEFAULT_AGENT_CONNECTION_TEST_TIMEOUT_MS,
);
