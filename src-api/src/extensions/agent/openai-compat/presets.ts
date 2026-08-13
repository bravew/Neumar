/**
 * OpenAI-Compatible Provider Presets
 *
 * Named configurations for popular cloud and local providers.
 * Used by the auto-detect endpoint and ModelSettings UI.
 */

export interface ProviderPreset {
  id: string;
  name: string;
  category: 'cloud' | 'local' | 'gateway';
  baseUrl: string;
  requiresAuth: boolean;
  defaultModels: string[];
  dialect?: 'standard' | 'kimi-k3';
  /** Endpoint to ping for local auto-detection (localhost only) */
  detectEndpoint?: string;
  /** Whether provider supports GET /v1/models for dynamic model discovery */
  supportsModelDiscovery?: boolean;
  notes?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ── Local Solutions ──
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'local',
    baseUrl: 'http://localhost:11434/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/api/tags',
    notes: 'Tool use supported v0.1.24+, Responses API v0.13.3+',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    category: 'local',
    baseUrl: 'http://localhost:1234/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    category: 'local',
    baseUrl: 'http://localhost:8000/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes: 'GPU-first, highest throughput (PagedAttention), production-grade',
  },
  {
    id: 'jan',
    name: 'Jan.ai',
    category: 'local',
    baseUrl: 'http://localhost:1337/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes: 'Desktop GUI, local-first, built-in model store',
  },
  {
    id: 'gpt4all',
    name: 'GPT4All',
    category: 'local',
    baseUrl: 'http://localhost:4891/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes: 'CPU-optimized, privacy-focused, no GPU needed',
  },
  {
    id: 'localai',
    name: 'LocalAI',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes: 'Drop-in OpenAI replacement, supports images/audio/embeddings',
  },
  {
    id: 'llamacpp',
    name: 'llama-server (llama.cpp)',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes: 'Pure C++, fastest CPU inference, GGUF format',
  },
  {
    id: 'koboldcpp',
    name: 'KoboldCpp',
    category: 'local',
    baseUrl: 'http://localhost:5001/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes: 'Creative writing / roleplay focus, built-in web UI',
  },
  {
    id: 'tgi',
    name: 'TGI (HuggingFace)',
    category: 'local',
    baseUrl: 'http://localhost:8080/v1',
    requiresAuth: false,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes: 'HuggingFace official, production-grade, tensor parallelism',
  },

  // ── Gateways ──
  {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'gateway',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresAuth: true,
    defaultModels: [
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-4-8',
      'anthropic/claude-sonnet-4-6',
      'openai/gpt-5.5',
      'google/gemini-2.5-pro',
      'meta-llama/llama-4-maverick',
    ],
    supportsModelDiscovery: true,
  },
  {
    id: 'litellm',
    name: 'LiteLLM',
    category: 'gateway',
    baseUrl: 'http://localhost:4000/v1',
    requiresAuth: true,
    defaultModels: [],
    detectEndpoint: '/v1/models',
    supportsModelDiscovery: true,
    notes:
      'Proxy for 100+ providers (Azure, Bedrock, Vertex) behind a single OpenAI-compatible API',
  },
  {
    id: 'portkey',
    name: 'Portkey',
    category: 'gateway',
    baseUrl: 'https://api.portkey.ai/v1',
    requiresAuth: true,
    defaultModels: [],
    supportsModelDiscovery: true,
    notes: '250+ models, caching, guardrails, observability',
  },
  {
    id: 'requesty',
    name: 'Requesty',
    category: 'gateway',
    baseUrl: 'https://router.requesty.ai/v1',
    requiresAuth: true,
    defaultModels: [],
    supportsModelDiscovery: true,
    notes: 'Simple multi-provider routing, $6 free credit',
  },

  // ── Tier 1: Frontier Cloud ──
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'cloud',
    baseUrl: 'https://api.openai.com/v1',
    requiresAuth: true,
    defaultModels: [
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'o3',
      'o3-pro',
    ],
    supportsModelDiscovery: true,
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    category: 'cloud',
    baseUrl: 'https://{your-resource}.openai.azure.com/openai/v1',
    requiresAuth: true,
    defaultModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    supportsModelDiscovery: true,
    notes:
      'Uses api-key header (not Bearer). Model param = deployment name. Replace {your-resource} with your Azure resource name.',
  },
  {
    id: 'azure-foundry',
    name: 'Azure AI Foundry',
    category: 'cloud',
    baseUrl: 'https://{your-resource}.services.ai.azure.com/openai/v1',
    requiresAuth: true,
    defaultModels: [
      'DeepSeek-R1',
      'Meta-Llama-3.1-405B-Instruct',
      'Mistral-large',
    ],
    supportsModelDiscovery: true,
    notes:
      'Unified endpoint for OpenAI + 3rd-party models (Llama, Mistral, DeepSeek). Uses api-key header. Replace {your-resource}.',
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    category: 'cloud',
    baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1',
    requiresAuth: true,
    defaultModels: [
      'mistral.mistral-large-3-675b-instruct',
      'qwen.qwen3-235b-a22b-2507',
      'deepseek.v3.1',
    ],
    supportsModelDiscovery: true,
    notes:
      'OpenAI-compatible via Mantle. Generate API key in AWS Console > Bedrock > API Keys. Replace region as needed.',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    category: 'cloud',
    baseUrl: 'https://api.x.ai/v1',
    requiresAuth: true,
    defaultModels: [
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-3',
      'grok-3-mini',
      'grok-2-vision',
    ],
    supportsModelDiscovery: true,
    notes: 'Grok 4.20 beta (2M context), multi-agent, vision support',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'cloud',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresAuth: true,
    defaultModels: ['deepseek-chat', 'deepseek-reasoner'],
    supportsModelDiscovery: true,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    category: 'cloud',
    baseUrl: 'https://api.mistral.ai/v1',
    requiresAuth: true,
    defaultModels: [
      'mistral-large-latest',
      'mistral-small-latest',
      'codestral-latest',
      'ministral-8b-latest',
    ],
    supportsModelDiscovery: true,
  },

  // ── Tier 2: Inference Providers ──
  {
    id: 'groq',
    name: 'Groq',
    category: 'cloud',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresAuth: true,
    defaultModels: [
      'gpt-oss-120b',
      'llama-4-scout-17b-16e',
      'qwen3-32b',
      'llama-3.3-70b',
    ],
    supportsModelDiscovery: true,
    notes: 'Ultra-fast LPU inference, free tier (30 req/min)',
  },
  {
    id: 'together',
    name: 'Together AI',
    category: 'cloud',
    baseUrl: 'https://api.together.xyz/v1',
    requiresAuth: true,
    defaultModels: [
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
      'deepseek-ai/DeepSeek-R1',
    ],
    supportsModelDiscovery: true,
    notes: '200+ models, Mamba-3 (SSM), Nemotron 3 Super (120B MoE)',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    category: 'cloud',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    requiresAuth: true,
    defaultModels: [
      'accounts/fireworks/models/llama-4-maverick-instruct-basic',
    ],
    supportsModelDiscovery: true,
    notes: 'FireAttention engine (4x throughput), 13T tok/day',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    category: 'cloud',
    baseUrl: 'https://api.cerebras.ai/v1',
    requiresAuth: true,
    defaultModels: ['qwen3-235b', 'llama-3.3-70b', 'gpt-oss-120b'],
    supportsModelDiscovery: true,
    notes:
      'Free tier (30 req/min, 1M tok/day), wafer-scale engine, 2222 tok/s on 8B',
  },
  {
    id: 'sambanova',
    name: 'SambaNova',
    category: 'cloud',
    baseUrl: 'https://api.sambanova.ai/v1',
    requiresAuth: true,
    defaultModels: ['Llama-4-Maverick-17B-128E-Instruct', 'DeepSeek-R1-0528'],
    supportsModelDiscovery: true,
    notes: 'Free API key via SambaCloud, RDU-based inference',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'cloud',
    baseUrl: 'https://api.perplexity.ai',
    requiresAuth: true,
    defaultModels: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsModelDiscovery: true,
    notes: 'Search-augmented, 1200 tok/s, citation tokens now free',
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    category: 'cloud',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    requiresAuth: true,
    defaultModels: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct'],
    supportsModelDiscovery: true,
    notes: '50+ open-source models',
  },
  {
    id: 'nebius',
    name: 'Nebius AI Studio',
    category: 'cloud',
    baseUrl: 'https://api.studio.nebius.ai/v1',
    requiresAuth: true,
    defaultModels: ['deepseek-ai/DeepSeek-V3-0324'],
    supportsModelDiscovery: true,
    notes: '60+ models, competitive pricing',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    category: 'cloud',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    requiresAuth: true,
    defaultModels: ['command-r-plus', 'command-r'],
    supportsModelDiscovery: true,
    notes:
      'RAG/search specialist, Embed v3, Rerank 3.5. Uses /compatibility/v1 for OpenAI compat.',
  },

  // ── Regional / Chinese Cloud ──
  {
    id: 'dashscope',
    name: 'Qwen (Dashscope)',
    category: 'cloud',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    requiresAuth: true,
    defaultModels: ['qwen-max', 'qwen-plus'],
    supportsModelDiscovery: true,
  },
  {
    id: 'moonshot-global',
    name: 'Kimi API (K3)',
    category: 'cloud',
    baseUrl: 'https://api.moonshot.ai/v1',
    requiresAuth: true,
    defaultModels: ['kimi-k3'],
    dialect: 'kimi-k3',
    supportsModelDiscovery: true,
    notes: 'K3 reasoning, coding, image, and video understanding',
  },
  {
    id: 'moonshot-cn',
    name: 'Moonshot China',
    category: 'cloud',
    baseUrl: 'https://api.moonshot.cn/v1',
    requiresAuth: true,
    defaultModels: ['kimi-k2.5', 'moonshot-v1-128k'],
    supportsModelDiscovery: true,
    notes: 'Regional endpoint retained for existing China deployments',
  },
  {
    id: 'zhipu',
    name: 'GLM (Zhipu AI)',
    category: 'cloud',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    requiresAuth: true,
    defaultModels: ['glm-4.7', 'glm-4-plus'],
    supportsModelDiscovery: true,
    notes: '200K context, thinking mode, strong tool calling',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    category: 'cloud',
    baseUrl: 'https://api.minimax.io/v1',
    requiresAuth: true,
    defaultModels: ['MiniMax-M2.5'],
    notes: 'Multi-step tool calling with interleaved thinking',
  },
  {
    id: 'stepfun',
    name: 'StepFun (阶跃星辰)',
    category: 'cloud',
    baseUrl: 'https://api.stepfun.com/v1',
    requiresAuth: true,
    defaultModels: ['step-3.5-flash', 'step-2-16k'],
  },
  {
    id: 'baichuan',
    name: 'Baichuan AI',
    category: 'cloud',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    requiresAuth: true,
    defaultModels: ['Baichuan4'],
  },
  {
    id: 'doubao',
    name: 'Doubao (ByteDance)',
    category: 'cloud',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    requiresAuth: true,
    defaultModels: ['doubao-seed-2.0', 'doubao-pro-256k'],
    notes: 'Also available via BytePlus ModelArk (already integrated)',
  },
];

/** Group presets by category */
export function getPresetsByCategory(): Record<
  'cloud' | 'local' | 'gateway',
  ProviderPreset[]
> {
  return {
    cloud: PROVIDER_PRESETS.filter((p) => p.category === 'cloud'),
    local: PROVIDER_PRESETS.filter((p) => p.category === 'local'),
    gateway: PROVIDER_PRESETS.filter((p) => p.category === 'gateway'),
  };
}

/** Local presets that support auto-detection */
export const LOCAL_PRESETS = PROVIDER_PRESETS.filter(
  (p) => p.category === 'local' && p.detectEndpoint,
);
