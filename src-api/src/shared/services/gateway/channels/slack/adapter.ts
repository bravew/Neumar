/**
 * Slack gateway adapter opt-out.
 *
 * Slack is still served by the active channel runtime at
 * `src-api/src/shared/channels/slack`. The generic gateway registry keeps this
 * factory only to make that migration decision explicit. Do not route Slack
 * through Gateway until there is a dedicated migration plan.
 */

import { createLogger } from '@/shared/utils/logger';

import { registerChannel } from '../registry';

const logger = createLogger('GatewaySlackAdapter');
let optOutLogged = false;

registerChannel('slack', () => {
  if (!optOutLogged) {
    logger.info(
      'Gateway Slack adapter disabled; active Slack runtime is src-api/src/shared/channels/slack',
    );
    optOutLogged = true;
  }
  return null;
});
