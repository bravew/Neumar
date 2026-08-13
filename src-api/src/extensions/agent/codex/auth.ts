import type { AgentConfig } from '@/core/agent/types';

export type CodexApiKeySource =
  | 'config'
  | 'CODEX_API_KEY'
  | 'OPENAI_API_KEY'
  | 'none';

export interface CodexApiKeyResolution {
  apiKey?: string;
  source: CodexApiKeySource;
}

type EnvLike = Record<string, string | undefined>;

export function resolveCodexApiKey(
  config: Pick<AgentConfig, 'apiKey' | 'baseUrl'>,
  env: EnvLike = process.env,
): CodexApiKeyResolution {
  const configured = normalizeKey(config.apiKey);
  if (configured) return { apiKey: configured, source: 'config' };

  const codexKey = normalizeKey(env.CODEX_API_KEY);
  if (codexKey) return { apiKey: codexKey, source: 'CODEX_API_KEY' };

  if (!resolveCodexOpenAiBaseUrl(config, env)) return { source: 'none' };

  const openAiKey = normalizeKey(env.OPENAI_API_KEY);
  if (openAiKey) return { apiKey: openAiKey, source: 'OPENAI_API_KEY' };

  return { source: 'none' };
}

export function resolveCodexOpenAiBaseUrl(
  config: Pick<AgentConfig, 'baseUrl'>,
  env: EnvLike = process.env,
): string | undefined {
  return normalizeKey(config.baseUrl) ?? normalizeKey(env.OPENAI_BASE_URL);
}

function normalizeKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
