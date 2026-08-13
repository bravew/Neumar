import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ProxyDispatcher');

const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY',
] as const;

export function hasFetchProxyEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return PROXY_ENV_KEYS.some((key) => {
    const value = env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function configureGlobalFetchProxyFromEnv(): boolean {
  if (!hasFetchProxyEnv()) return false;

  setGlobalDispatcher(new EnvHttpProxyAgent());
  logger.info(
    'Configured global fetch proxy dispatcher from HTTP(S)_PROXY/NO_PROXY environment.',
  );
  return true;
}
