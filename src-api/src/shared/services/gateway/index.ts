/**
 * Gateway Module Bootstrap
 *
 * Initializes and exports the gateway for integration with the API server.
 */

import { createLogger } from '@/shared/utils/logger';

import { getGateway } from './core/gateway';
import { isGatewayEnabled } from './shared/config/loader';

const logger = createLogger('GatewayBootstrap');

export { Gateway, getGateway } from './core/gateway';
export { GatewayMetrics } from './shared/metrics';
export type { GatewayConfig } from './shared/config/types';

/**
 * Start the gateway if enabled in config.
 * Called during API server startup.
 */
export async function startGateway(): Promise<void> {
  if (!isGatewayEnabled()) {
    logger.info('Gateway disabled, skipping startup');
    return;
  }

  try {
    const gateway = getGateway();
    await gateway.start();
  } catch (err) {
    logger.error(
      'Failed to start gateway',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Stop the gateway gracefully.
 * Called during API server shutdown.
 */
export async function stopGateway(): Promise<void> {
  try {
    const gateway = getGateway();
    if (gateway.isRunning()) {
      await gateway.stop();
    }
  } catch (err) {
    logger.error(
      'Failed to stop gateway',
      err instanceof Error ? err.message : String(err),
    );
  }
}
