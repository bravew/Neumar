import { ComposioProvider } from './provider';

let singleton: ComposioProvider | null = null;

export function getComposioProvider(): ComposioProvider {
  singleton ??= new ComposioProvider();
  return singleton;
}

export function resetComposioProviderForTests(): void {
  singleton = null;
}

export { ComposioProvider };
export type {
  ComposioConnectionCompletion,
  ComposioConnectionStart,
  ComposioProviderOptions,
} from './provider';
export { ComposioClient } from './client';
export {
  MemoryComposioConfigStore,
  SettingsComposioConfigStore,
  type ComposioConfigStore,
} from './config';
export { ConnectorServiceError } from './errors';
