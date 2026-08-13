/**
 * Provider-specific HTTP headers.
 *
 * Centralises extra headers required by specific providers so every call-site
 * (provider test routes, agent SDK client, title generator, etc.) stays in sync.
 */

/** Azure OpenAI / Azure AI Foundry host patterns (use api-key header instead of Bearer) */
const AZURE_HOST_PATTERNS = ['.openai.azure.com', '.services.ai.azure.com'];

/**
 * Check if a base URL points to an Azure endpoint.
 * Azure uses `api-key` header instead of `Authorization: Bearer`.
 */
export function isAzureEndpoint(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return AZURE_HOST_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Build extra headers required by specific providers.
 * - OpenRouter free models require HTTP-Referer and X-Title for data policy.
 * - Azure endpoints use `api-key` header instead of `Authorization: Bearer`.
 */
export function getProviderHeaders(
  baseUrl: string,
  _apiKey?: string,
): Record<string, string> {
  const lower = baseUrl.toLowerCase();

  if (lower.includes('openrouter.ai')) {
    return {
      'HTTP-Referer': 'https://neumar.ai',
      'X-Title': 'Neumar',
    };
  }

  return {};
}

/**
 * Build the Authorization header for a provider.
 * Azure endpoints skip this (they use api-key instead).
 */
export function getAuthHeader(
  baseUrl: string,
  apiKey: string,
): Record<string, string> {
  if (isAzureEndpoint(baseUrl)) {
    return { 'api-key': apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}
