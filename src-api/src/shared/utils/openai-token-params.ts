import { isAzureEndpoint } from '@/shared/utils/provider-headers';

export type OpenAICompatTokenParam = 'max_tokens' | 'max_completion_tokens';

interface TokenParamModelRule {
  name: string;
  pattern: RegExp;
}

export const MAX_COMPLETION_TOKEN_MODEL_RULES: TokenParamModelRule[] = [
  { name: 'o-series', pattern: /^o(?:\d|[.-])/i },
  { name: 'gpt-5', pattern: /^gpt-5(?:[.\w-]|$)/i },
];

function modelFamily(model: string): string {
  return model.trim().split('/').pop() ?? model.trim();
}

function isNativeOpenAIBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  try {
    return new URL(trimmed).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return trimmed.toLowerCase().startsWith('api.openai.com');
  }
}

export function modelRequiresMaxCompletionTokens(model: string): boolean {
  const family = modelFamily(model);
  return MAX_COMPLETION_TOKEN_MODEL_RULES.some((rule) =>
    rule.pattern.test(family),
  );
}

export function resolveOpenAICompatTokenParam(
  baseUrl: string,
  model: string,
): OpenAICompatTokenParam {
  if (isNativeOpenAIBaseUrl(baseUrl) || isAzureEndpoint(baseUrl)) {
    return 'max_completion_tokens';
  }

  if (modelRequiresMaxCompletionTokens(model)) {
    return 'max_completion_tokens';
  }

  return 'max_tokens';
}

export function alternateOpenAICompatTokenParam(
  param: OpenAICompatTokenParam,
): OpenAICompatTokenParam {
  return param === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
}

export function shouldRetryOpenAICompatTokenParam(
  errorBody: string,
  alternateParam: OpenAICompatTokenParam,
): boolean {
  const lower = errorBody.toLowerCase();
  return lower.includes(alternateParam.toLowerCase());
}
