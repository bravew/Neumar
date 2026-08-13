/**
 * Public surface for first-party MCP servers and cloud-storage adapters
 * to obtain a Composio-backed OAuth access token. The orchestration is
 * implemented in `access-token.ts`; the pure cache lives in
 * `credentials-cache.ts`. This file is a thin re-export so external
 * callers can keep importing from `./credentials`.
 */
export {
  ComposioCredentialError,
  clearComposioCredentialCache,
  fetchComposioAccessToken,
} from './access-token';
export type { CachedAccessToken } from './credentials-cache';
