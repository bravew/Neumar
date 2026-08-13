import { useSyncExternalStore } from 'react';

import {
  getProviderModelsCacheVersion,
  subscribeProviderModelsCache,
} from '@/shared/lib/provider-models-cache';

export function useProviderModelsCacheVersion() {
  return useSyncExternalStore(
    subscribeProviderModelsCache,
    getProviderModelsCacheVersion,
    getProviderModelsCacheVersion,
  );
}
