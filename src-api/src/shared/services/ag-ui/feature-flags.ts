// Read on every call — operators can flip from Settings without restarting.

import { getSetting } from '@/shared/db/operations';

const FLAG_KEY = 'feature.aguiV2';

export function isAguiV2Enabled(): boolean {
  return getSetting(FLAG_KEY) === 'true';
}
