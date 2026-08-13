import type { AIProvider } from '../types';

export interface FetchedModel {
  id: string;
  name?: string;
  displayLabel?: string;
}

export interface FetchModelsResponse {
  success: boolean;
  models: FetchedModel[];
  totalCount: number;
  latencyMs?: number;
  upstreamStatus?: number | null;
  message?: string;
}

export interface FetchModelsPanelProps {
  provider: AIProvider;
  onModelsChange: (models: string[]) => void;
}

/** Default API base URLs for native providers that leave baseUrl empty. */
const NATIVE_DEFAULT_URLS: Record<string, string> = {
  claude: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

/** Resolve a provider's effective base URL (fills in defaults for native agents). */
export function resolveBaseUrl(
  provider: FetchModelsPanelProps['provider'],
): string {
  if (provider.baseUrl) return provider.baseUrl;
  if (provider.agentType && NATIVE_DEFAULT_URLS[provider.agentType]) {
    return NATIVE_DEFAULT_URLS[provider.agentType];
  }
  return '';
}
