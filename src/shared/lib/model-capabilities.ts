/**
 * Model Capability Detection System
 *
 * Single source of truth for identifying AI model capabilities from their names.
 * Used by both the frontend (UI badges, routing filters) and referenced by the
 * backend (test endpoint strategy selection in src-api/src/app/api/providers.ts).
 *
 * Coverage includes all major providers as of 2026-06:
 *   - Anthropic (Claude Sonnet 5, Opus/Sonnet/Haiku 3–4.8 plus known Fable/Mythos IDs)
 *   - OpenAI (GPT-3.5 → GPT-5.5, o-series, DALL·E, Sora, Whisper, TTS, Codex, embeddings)
 *   - Google (Gemini 2.x–3.x Pro/Flash/Lite, Imagen, Veo)
 *   - Meta (Llama 3.x–4 Scout/Maverick, CodeLlama, LLaVA)
 *   - Mistral (Large/Medium/Small, Ministral, Codestral, Pixtral, Magistral, Voxtral)
 *   - DeepSeek (V3.x, R1, Coder)
 *   - Alibaba (Qwen 2.5–3, Qwen-VL, Qwen-Coder, Qwen-Embedding)
 *   - xAI (Grok 2–4, Grok-Code, Grok-Vision, Grok-Imagine)
 *   - Cohere (Command R/A, Embed, Rerank)
 *   - BytePlus (Seed LLM, Seedance, Seedream, Seededit, embeddings)
 *   - HuggingFace / Open-source (StarCoder, Falcon, Phi, Yi, Gemma, Granite, Internlm)
 *   - Image gen (Flux, Stable Diffusion, Midjourney, Ideogram, Recraft, Leonardo)
 *   - Video gen (Sora, Runway, Kling, Pika, Luma, Hailuo/Minimax, Haiper, CogVideo)
 *   - Audio (Whisper, TTS, ElevenLabs, Bark, XTTS, Kokoro, Voxtral, MusicGen, Suno)
 *   - Embedding (text-embedding-3, Voyage, Jina, Nomic, BGE, Cohere embed)
 *
 * @module model-capabilities
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Model capability categories.
 *
 * Based on the industry taxonomy used by OpenRouter, Azure AI Catalog,
 * BytePlus ModelArk, and Google Vertex AI.
 */
export type ModelCapability =
  | 'chat' //  Text generation / chat completion (LLMs)
  | 'reasoning' //  Deep thinking / chain-of-thought models
  | 'code' //  Code generation / code review specialized
  | 'vision' //  Image understanding / multi-modal input
  | 'video-input' // Video understanding input (not video generation)
  | 'image' //  Image generation (text-to-image)
  | 'video' //  Video generation (text/image-to-video)
  | 'audio' //  Audio / speech (TTS, STT, music)
  | 'embedding'; // Text / multi-modal embedding

/** Display metadata for each capability — icon, label, Tailwind color classes */
export const MODEL_CAPABILITY_META: Record<
  ModelCapability,
  { label: string; icon: string; color: string }
> = {
  chat: {
    label: 'Chat',
    icon: '💬',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  reasoning: {
    label: 'Reasoning',
    icon: '🧠',
    color:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
  code: {
    label: 'Code',
    icon: '⌨️',
    color:
      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
  vision: {
    label: 'Vision',
    icon: '👁️',
    color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  },
  'video-input': {
    label: 'Video input',
    icon: '🎞️',
    color:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  image: {
    label: 'Image',
    icon: '🎨',
    color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  },
  video: {
    label: 'Video',
    icon: '🎬',
    color:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
  audio: {
    label: 'Audio',
    icon: '🔊',
    color:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  embedding: {
    label: 'Embedding',
    icon: '📐',
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400',
  },
};

/** Canonical display order — most agent-relevant first */
export const CAPABILITY_DISPLAY_ORDER: ModelCapability[] = [
  'chat',
  'reasoning',
  'code',
  'vision',
  'video-input',
  'image',
  'video',
  'audio',
  'embedding',
];

// ============================================================================
// Detection Rules
// ============================================================================

/**
 * Pattern-based rules for detecting model capabilities from model name.
 *
 * Each rule maps a regex pattern to one or more capabilities.
 * Rules are evaluated top-to-bottom; a model can match multiple rules,
 * and capabilities accumulate (union).
 *
 * If no rules match, the function defaults to ['chat'].
 *
 * IMPORTANT — Ordering matters:
 *   1. Non-chat-only models (video, image, audio, embedding) come first
 *      so they are never accidentally tagged with 'chat'.
 *   2. Specific model families (reasoning, code, vision) come next.
 *   3. Broad chat-model patterns come last as catch-alls.
 *
 * When adding new models:
 *   - Put more specific patterns BEFORE broader ones
 *   - Include the provider name if the model name is ambiguous
 *   - Add a comment with the provider name
 *   - Also update the backend mirror in src-api/src/app/api/providers.ts
 *     (NON_CHAT_MODEL_PATTERNS) for non-chat models
 */
const MODEL_CAPABILITY_RULES: Array<{
  pattern: RegExp;
  capabilities: ModelCapability[];
}> = [
  // ════════════════════════════════════════════════════════════════════
  // VIDEO GENERATION (non-chat — these NEVER get 'chat' tag)
  // ════════════════════════════════════════════════════════════════════

  // BytePlus / ByteDance (includes dreamina-seedance-2-0-* model IDs)
  { pattern: /^(?:dreamina-)?seedance/i, capabilities: ['video'] },
  { pattern: /^doubao-seedance-/i, capabilities: ['video'] },
  // OpenAI
  { pattern: /^sora/i, capabilities: ['video'] },
  // Runway
  { pattern: /^runway/i, capabilities: ['video'] },
  { pattern: /^gen-[2-9]/i, capabilities: ['video'] }, // gen-2, gen-3, gen-4
  // Kuaishou
  { pattern: /^kling/i, capabilities: ['video'] },
  // Pika Labs
  { pattern: /^pika/i, capabilities: ['video'] },
  // Luma AI / Dream Machine
  { pattern: /^luma/i, capabilities: ['video'] },
  { pattern: /^dream[-_]?machine/i, capabilities: ['video'] },
  { pattern: /^ray-?2/i, capabilities: ['video'] }, // Luma Ray2
  // Hailuo / Minimax video
  { pattern: /^hailuo/i, capabilities: ['video'] },
  { pattern: /^minimax.*video/i, capabilities: ['video'] },
  // Haiper
  { pattern: /^haiper/i, capabilities: ['video'] },
  // Google Veo
  { pattern: /^veo/i, capabilities: ['video'] },
  // Google Gemini video generation (future models)
  { pattern: /gemini.*video/i, capabilities: ['video'] },
  // Open-source video
  { pattern: /^cogvideo/i, capabilities: ['video'] },
  { pattern: /^mochi[-_]/i, capabilities: ['video'] },
  { pattern: /^ltx[-_]?video/i, capabilities: ['video'] },
  { pattern: /^hunyuan[-_]?video/i, capabilities: ['video'] },
  // Generic
  { pattern: /video[-_]gen/i, capabilities: ['video'] },

  // ════════════════════════════════════════════════════════════════════
  // IMAGE GENERATION (non-chat — these NEVER get 'chat' tag)
  // ════════════════════════════════════════════════════════════════════

  // BytePlus / ByteDance
  { pattern: /seedream/i, capabilities: ['image'] },
  { pattern: /seededit/i, capabilities: ['image'] },
  { pattern: /^senseaudio-image-/i, capabilities: ['image'] },
  { pattern: /^sensenova-u1-fast$/i, capabilities: ['image'] },
  // OpenAI
  { pattern: /^dall-e/i, capabilities: ['image'] },
  { pattern: /^gpt-image/i, capabilities: ['image'] }, // gpt-image-1, gpt-image-1.5
  { pattern: /^chatgpt-image/i, capabilities: ['image'] }, // chatgpt-image-latest
  // Stability AI
  { pattern: /^stable[-_]?diffusion/i, capabilities: ['image'] },
  { pattern: /^sdxl/i, capabilities: ['image'] },
  { pattern: /^sd[_-]?[23]/i, capabilities: ['image'] }, // sd-3, sd3
  { pattern: /^stable[-_]?image/i, capabilities: ['image'] },
  // Black Forest Labs
  { pattern: /^flux/i, capabilities: ['image'] },
  // Midjourney
  { pattern: /^midjourney/i, capabilities: ['image'] },
  // Ideogram
  { pattern: /^ideogram/i, capabilities: ['image'] },
  // Recraft
  { pattern: /^recraft/i, capabilities: ['image'] },
  // Leonardo AI
  { pattern: /^leonardo/i, capabilities: ['image'] },
  // OpenAI-compatible media providers
  { pattern: /^custom-image(?::|$)/i, capabilities: ['image'] },
  { pattern: /^imagerouter(?::|$)/i, capabilities: ['image', 'video'] },
  // Google Imagen
  { pattern: /^imagen/i, capabilities: ['image'] },
  // Hunyuan Image
  { pattern: /^hunyuan[-_]?image/i, capabilities: ['image'] },
  // Playground AI
  { pattern: /^playground[-_]v/i, capabilities: ['image'] },
  // Gemini image generation variants (gemini-*-image, gemini-*-image-preview, etc.)
  { pattern: /gemini.*image/i, capabilities: ['image', 'chat'] },

  // ════════════════════════════════════════════════════════════════════
  // AUDIO / SPEECH (non-chat unless explicitly multi-modal)
  // ════════════════════════════════════════════════════════════════════

  // OpenAI TTS
  { pattern: /^tts-/i, capabilities: ['audio'] },
  { pattern: /^gpt-4o-mini-tts/i, capabilities: ['audio'] },
  // OpenAI STT / Transcription
  { pattern: /^whisper/i, capabilities: ['audio'] },
  { pattern: /^gpt-4o-transcribe/i, capabilities: ['audio'] },
  { pattern: /^gpt-4o-mini-transcribe/i, capabilities: ['audio'] },
  // OpenAI Realtime / Audio (these are multi-modal chat + audio)
  { pattern: /^gpt-realtime/i, capabilities: ['chat', 'audio'] },
  { pattern: /^gpt-audio/i, capabilities: ['chat', 'audio'] },
  { pattern: /realtime-preview$/i, capabilities: ['chat', 'audio'] },
  // Google Gemini audio / TTS
  { pattern: /gemini.*native[-_]?audio/i, capabilities: ['chat', 'audio'] },
  { pattern: /gemini.*tts/i, capabilities: ['audio'] },
  // Mistral audio
  { pattern: /^voxtral/i, capabilities: ['audio'] },
  // ElevenLabs
  { pattern: /^eleven[-_]/i, capabilities: ['audio'] },
  // Deepgram STT
  { pattern: /^nova[-_]?[23]/i, capabilities: ['audio'] },
  { pattern: /^deepgram/i, capabilities: ['audio'] },
  // Deepgram TTS
  { pattern: /^aura[-_]/i, capabilities: ['audio'] },
  // Cartesia
  { pattern: /^sonic[-_]/i, capabilities: ['audio'] },
  // SenseVoice (local STT)
  { pattern: /^sensevoice/i, capabilities: ['audio'] },
  // SenseAudio hosted ASR/TTS/music
  { pattern: /^senseaudio-(?:asr|tts|music)-/i, capabilities: ['audio'] },
  // Piper (local TTS)
  { pattern: /^piper/i, capabilities: ['audio'] },
  // Open-source TTS
  { pattern: /^bark/i, capabilities: ['audio'] },
  { pattern: /^xtts/i, capabilities: ['audio'] },
  { pattern: /^kokoro/i, capabilities: ['audio'] },
  { pattern: /^orpheus/i, capabilities: ['audio'] },
  { pattern: /^parler[-_]tts/i, capabilities: ['audio'] },
  { pattern: /^metavoice/i, capabilities: ['audio'] },
  { pattern: /^chatterbox/i, capabilities: ['audio'] },
  { pattern: /^chattts/i, capabilities: ['audio'] },
  { pattern: /^fish[-_]speech/i, capabilities: ['audio'] },
  // Music generation
  { pattern: /^musicgen/i, capabilities: ['audio'] },
  { pattern: /^stable[-_]?audio/i, capabilities: ['audio'] },
  // Generic audio pattern (keep after specific ones)
  { pattern: /^speech[-_]/i, capabilities: ['audio'] },

  // ════════════════════════════════════════════════════════════════════
  // EMBEDDING (non-chat)
  // ════════════════════════════════════════════════════════════════════

  // OpenAI
  { pattern: /^text-embedding/i, capabilities: ['embedding'] },
  // Cohere
  { pattern: /^embed-/i, capabilities: ['embedding'] },
  { pattern: /^cohere[-/]embed/i, capabilities: ['embedding'] },
  // Voyage AI
  { pattern: /^voyage/i, capabilities: ['embedding'] },
  // Jina AI
  { pattern: /^jina[-_]embed/i, capabilities: ['embedding'] },
  // Nomic
  { pattern: /^nomic[-_]embed/i, capabilities: ['embedding'] },
  // BGE (BAAI)
  { pattern: /^bge[-_]/i, capabilities: ['embedding'] },
  // BytePlus
  { pattern: /^embedding[-_]vision/i, capabilities: ['embedding'] },
  // Mistral
  { pattern: /^mistral[-_]embed/i, capabilities: ['embedding'] },
  // Qwen
  { pattern: /^qwen.*embedding/i, capabilities: ['embedding'] },
  // Google
  { pattern: /^gemini[-_]embed/i, capabilities: ['embedding'] },
  // Generic (keep last in embedding section)
  { pattern: /[-_]embedding[-_]|[-_]embed$/i, capabilities: ['embedding'] },

  // ════════════════════════════════════════════════════════════════════
  // MODERATION / RERANK / OTHER NON-CHAT (non-chat)
  // ════════════════════════════════════════════════════════════════════

  { pattern: /^text-moderation/i, capabilities: ['chat'] }, // Technically chat-like
  { pattern: /^omni-moderation/i, capabilities: ['chat', 'vision'] },
  { pattern: /^rerank/i, capabilities: ['embedding'] }, // Rerank is embedding-adjacent
  { pattern: /^cohere[-/]rerank/i, capabilities: ['embedding'] },

  // ════════════════════════════════════════════════════════════════════
  // REASONING / DEEP-THINKING MODELS (chat + reasoning)
  // ════════════════════════════════════════════════════════════════════

  // OpenAI o-series (o1, o3, o4-mini, o3-pro, o3-deep-research)
  {
    pattern: /^o[1-4]/i,
    capabilities: ['chat', 'reasoning', 'code', 'vision'],
  },
  // OpenAI deep research
  { pattern: /deep[-_]?research/i, capabilities: ['chat', 'reasoning'] },
  // DeepSeek R1
  {
    pattern: /deepseek[-_]?r1/i,
    capabilities: ['chat', 'reasoning', 'code'],
  },
  // Mistral Magistral
  { pattern: /^magistral/i, capabilities: ['chat', 'reasoning'] },
  // Cohere Command A Reasoning
  { pattern: /command.*reason/i, capabilities: ['chat', 'reasoning'] },
  // Generic reasoning markers
  { pattern: /[-_]thinking/i, capabilities: ['chat', 'reasoning'] },
  { pattern: /[-_]deepthink/i, capabilities: ['chat', 'reasoning'] },

  // ════════════════════════════════════════════════════════════════════
  // CODE-SPECIALIZED MODELS (chat + code)
  // ════════════════════════════════════════════════════════════════════

  // OpenAI Codex series
  { pattern: /codex/i, capabilities: ['chat', 'code'] },
  // Mistral Codestral
  { pattern: /^codestral/i, capabilities: ['chat', 'code'] },
  // DeepSeek Coder
  { pattern: /deepseek[-_]?coder/i, capabilities: ['chat', 'code'] },
  // Qwen Coder
  { pattern: /qwen.*coder/i, capabilities: ['chat', 'code'] },
  // Meta CodeLlama
  { pattern: /^code[-_]?llama/i, capabilities: ['chat', 'code'] },
  // HuggingFace StarCoder
  { pattern: /^starcoder/i, capabilities: ['chat', 'code'] },
  // Google CodeGemma
  { pattern: /^code[-_]?gemma/i, capabilities: ['chat', 'code'] },
  // IBM Granite Code
  { pattern: /^granite.*code/i, capabilities: ['chat', 'code'] },
  // xAI Grok Code
  { pattern: /^grok[-_]code/i, capabilities: ['chat', 'code'] },
  // Cursor (model alias)
  { pattern: /^cursor/i, capabilities: ['chat', 'code'] },
  // Generic code markers
  { pattern: /[-_]code[-_]/i, capabilities: ['chat', 'code'] },

  // ════════════════════════════════════════════════════════════════════
  // VISION / MULTI-MODAL UNDERSTANDING (chat + vision)
  // ════════════════════════════════════════════════════════════════════

  // LLaVA (vision-language)
  { pattern: /^llava/i, capabilities: ['chat', 'vision'] },
  // Qwen VL
  { pattern: /qwen.*vl/i, capabilities: ['chat', 'vision'] },
  // InternVL / InternLM-XComposer
  { pattern: /^intern[-_]?vl/i, capabilities: ['chat', 'vision'] },
  { pattern: /^internlm.*visual/i, capabilities: ['chat', 'vision'] },
  // Mistral Pixtral
  { pattern: /^pixtral/i, capabilities: ['chat', 'vision'] },
  // Cohere Command A Vision
  { pattern: /command.*vision/i, capabilities: ['chat', 'vision'] },
  // xAI Grok Vision
  { pattern: /grok.*vision/i, capabilities: ['chat', 'vision'] },
  // Generic vision marker
  { pattern: /[-_]vision/i, capabilities: ['chat', 'vision'] },

  // ════════════════════════════════════════════════════════════════════
  // SPECIFIC MODEL FAMILIES (chat + specific capabilities)
  // ════════════════════════════════════════════════════════════════════

  // ── Anthropic Claude ──────────────────────────────────────────────
  // All Claude models support vision; tiers differ in reasoning/code strength
  {
    pattern: /claude.*(fable|mythos)/i,
    capabilities: ['chat', 'vision', 'reasoning', 'code'],
  },
  {
    pattern: /claude.*opus/i,
    capabilities: ['chat', 'vision', 'reasoning', 'code'],
  },
  {
    pattern: /claude.*sonnet/i,
    capabilities: ['chat', 'vision', 'code', 'reasoning'],
  },
  { pattern: /claude.*haiku/i, capabilities: ['chat', 'vision'] },

  // ── OpenAI GPT-5.x ───────────────────────────────────────────────
  {
    pattern: /^gpt-5/i,
    capabilities: ['chat', 'vision', 'code', 'reasoning'],
  },
  // ── OpenAI GPT-4.1 ───────────────────────────────────────────────
  { pattern: /^gpt-4\.1/i, capabilities: ['chat', 'vision', 'code'] },
  // ── OpenAI GPT-4o ─────────────────────────────────────────────────
  { pattern: /^gpt-4o/i, capabilities: ['chat', 'vision', 'code'] },
  // ── OpenAI GPT-4 Turbo ────────────────────────────────────────────
  { pattern: /^gpt-4-turbo/i, capabilities: ['chat', 'vision'] },
  // ── OpenAI GPT-oss (open-source) ──────────────────────────────────
  { pattern: /^gpt-oss/i, capabilities: ['chat', 'code'] },

  // ── Google Gemini ─────────────────────────────────────────────────
  // All Gemini models support vision, code, and reasoning
  {
    pattern: /^gemini[-_]?3/i,
    capabilities: ['chat', 'vision', 'code', 'reasoning'],
  },
  {
    pattern: /^gemini[-_]?2/i,
    capabilities: ['chat', 'vision', 'code', 'reasoning'],
  },
  { pattern: /^gemini[-_]?1/i, capabilities: ['chat', 'vision'] },
  {
    pattern: /^gemini[-_]?pro/i,
    capabilities: ['chat', 'vision', 'code', 'reasoning'],
  },
  {
    pattern: /^gemini[-_]?flash/i,
    capabilities: ['chat', 'vision', 'code'],
  },

  // ── Meta Llama 4 ──────────────────────────────────────────────────
  // Llama 4 Scout/Maverick are multimodal (text + image)
  {
    pattern: /^llama[-_]?4/i,
    capabilities: ['chat', 'vision', 'code'],
  },
  {
    pattern: /maverick/i,
    capabilities: ['chat', 'vision', 'code'],
  },
  { pattern: /scout/i, capabilities: ['chat', 'vision'] },
  { pattern: /behemoth/i, capabilities: ['chat', 'reasoning', 'code'] },

  // ── Mistral Large/Medium ──────────────────────────────────────────
  // Mistral Large 3, Medium 3.1 support vision
  {
    pattern: /^mistral[-_]?large/i,
    capabilities: ['chat', 'vision', 'code'],
  },
  { pattern: /^mistral[-_]?medium/i, capabilities: ['chat', 'vision'] },
  {
    pattern: /^mistral[-_]?small/i,
    capabilities: ['chat', 'vision'],
  },
  { pattern: /^ministral/i, capabilities: ['chat', 'vision'] },
  { pattern: /^devstral/i, capabilities: ['chat', 'code'] },

  // ── DeepSeek V3.x ────────────────────────────────────────────────
  {
    pattern: /^deepseek[-_]?v3/i,
    capabilities: ['chat', 'code', 'reasoning'],
  },
  { pattern: /^deepseek[-_]?v2/i, capabilities: ['chat', 'code'] },
  { pattern: /^deepseek[-_]?chat/i, capabilities: ['chat'] },

  // ── xAI Grok ──────────────────────────────────────────────────────
  // non-reasoning MUST come before reasoning (both contain "reasoning")
  {
    pattern: /grok.*fast.*non[-_]?reasoning/i,
    capabilities: ['chat', 'vision', 'code'],
  },
  {
    pattern: /grok.*fast.*reasoning/i,
    capabilities: ['chat', 'reasoning', 'code'],
  },
  {
    pattern: /^grok[-_]?4/i,
    capabilities: ['chat', 'reasoning', 'code'],
  },
  { pattern: /^grok[-_]?3/i, capabilities: ['chat', 'reasoning'] },
  { pattern: /^grok[-_]?2.*vision/i, capabilities: ['chat', 'vision'] },
  { pattern: /^grok[-_]?2/i, capabilities: ['chat'] },
  // Grok image generation
  { pattern: /^grok[-_]?imagine/i, capabilities: ['image'] },
  { pattern: /grok.*image/i, capabilities: ['image'] },

  // ── Perplexity Sonar ──────────────────────────────────────────────
  {
    pattern: /sonar.*reasoning/i,
    capabilities: ['chat', 'reasoning'],
  },
  { pattern: /^sonar/i, capabilities: ['chat'] },

  // ── Cohere Command ────────────────────────────────────────────────
  { pattern: /^command[-_]?a/i, capabilities: ['chat', 'code'] },
  { pattern: /^command[-_]?r.*plus/i, capabilities: ['chat', 'code'] },
  { pattern: /^command[-_]?r/i, capabilities: ['chat'] },

  // ── Qwen 3 ────────────────────────────────────────────────────────
  {
    pattern: /^qwen[-_]?3(?!.*(?:vl|embed|code))/i,
    capabilities: ['chat', 'reasoning'],
  },
  // ── Qwen 2.5 / 2 ─────────────────────────────────────────────────
  { pattern: /^qwen[-_]?2/i, capabilities: ['chat'] },

  // ── BytePlus / ByteDance ──────────────────────────────────────────
  // Seed LLM (text + reasoning)
  { pattern: /^seed[-_]\d/i, capabilities: ['chat', 'reasoning'] },
  { pattern: /^seed[-_]translation/i, capabilities: ['chat'] },
  // Skylark
  { pattern: /^skylark/i, capabilities: ['chat'] },

  // ── GLM (Zhipu AI) ───────────────────────────────────────────────
  { pattern: /^glm[-_]?4/i, capabilities: ['chat', 'vision'] },
  { pattern: /^glm/i, capabilities: ['chat'] },

  // ── Yi (01.AI) ────────────────────────────────────────────────────
  { pattern: /^yi[-_]?vision/i, capabilities: ['chat', 'vision'] },
  { pattern: /^yi[-_]/i, capabilities: ['chat'] },

  // ── Moonshot / Kimi ───────────────────────────────────────────────
  {
    pattern: /^(?:kimi-k3|kimi-code\/k3)$/i,
    capabilities: ['chat', 'reasoning', 'code', 'vision', 'video-input'],
  },
  { pattern: /^kimi/i, capabilities: ['chat'] },
  { pattern: /^moonshot/i, capabilities: ['chat'] },

  // ── Microsoft Phi ─────────────────────────────────────────────────
  { pattern: /^phi[-_]/i, capabilities: ['chat'] },

  // ── Google Gemma ──────────────────────────────────────────────────
  { pattern: /^gemma/i, capabilities: ['chat'] },

  // ── Falcon (TII) ─────────────────────────────────────────────────
  { pattern: /^falcon/i, capabilities: ['chat'] },

  // ── IBM Granite ───────────────────────────────────────────────────
  { pattern: /^granite/i, capabilities: ['chat'] },

  // ── InternLM ──────────────────────────────────────────────────────
  { pattern: /^internlm/i, capabilities: ['chat'] },

  // ── Minimax (chat variant) ────────────────────────────────────────
  { pattern: /^minimax/i, capabilities: ['chat'] },

  // ── WizardLM / Wizard Coder ───────────────────────────────────────
  { pattern: /^wizard[-_]?coder/i, capabilities: ['chat', 'code'] },
  { pattern: /^wizard/i, capabilities: ['chat'] },

  // ── Open-source catch-alls ────────────────────────────────────────
  { pattern: /^nous[-_]?hermes/i, capabilities: ['chat'] },
  { pattern: /^solar/i, capabilities: ['chat'] },
  { pattern: /^dolphin/i, capabilities: ['chat'] },
  { pattern: /^neural[-_]?chat/i, capabilities: ['chat'] },
  { pattern: /^open[-_]?chat/i, capabilities: ['chat'] },
  { pattern: /^open[-_]?hermes/i, capabilities: ['chat'] },
  { pattern: /^zephyr/i, capabilities: ['chat'] },

  // ════════════════════════════════════════════════════════════════════
  // BROAD CATCH-ALL PATTERNS (keep at the very bottom)
  // These match by provider prefix for models not caught above
  // ════════════════════════════════════════════════════════════════════

  { pattern: /^gpt-/i, capabilities: ['chat'] },
  { pattern: /^claude/i, capabilities: ['chat', 'vision'] },
  { pattern: /^gemini/i, capabilities: ['chat', 'vision'] },
  { pattern: /^grok/i, capabilities: ['chat'] },
  { pattern: /^llama/i, capabilities: ['chat'] },
  { pattern: /^mistral/i, capabilities: ['chat'] },
  { pattern: /^qwen/i, capabilities: ['chat'] },
  { pattern: /^deepseek/i, capabilities: ['chat'] },
  { pattern: /^command/i, capabilities: ['chat'] },

  // OpenRouter uses "provider/model" format — strip prefix and try again
  // (handled in detectModelCapabilities itself, not here)
];

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect model capabilities from its name.
 *
 * Returns an array of capabilities. If no pattern matches,
 * defaults to ['chat'] (the most common model type).
 *
 * Handles OpenRouter-style "provider/model" names by stripping the prefix.
 *
 * @example
 * detectModelCapabilities('claude-sonnet-4-6')
 *   // → ['chat', 'vision', 'code', 'reasoning']
 *
 * detectModelCapabilities('gpt-5.5')
 *   // → ['chat', 'vision', 'code', 'reasoning']
 *
 * detectModelCapabilities('seedance-1-5-pro')
 *   // → ['video']
 *
 * detectModelCapabilities('seedream-4-5-251128')
 *   // → ['image']
 *
 * detectModelCapabilities('text-embedding-3-large')
 *   // → ['embedding']
 *
 * detectModelCapabilities('anthropic/claude-sonnet-4.5')
 *   // → ['chat', 'vision', 'code', 'reasoning']  (OpenRouter format)
 *
 * detectModelCapabilities('gpt-realtime-mini')
 *   // → ['chat', 'audio']
 */
export function detectModelCapabilities(modelName: string): ModelCapability[] {
  // Handle OpenRouter "provider/model" format
  const name = modelName.includes('/')
    ? modelName.split('/').pop()!
    : modelName;

  const capabilities = new Set<ModelCapability>();

  for (const rule of MODEL_CAPABILITY_RULES) {
    if (rule.pattern.test(name)) {
      for (const cap of rule.capabilities) {
        capabilities.add(cap);
      }
    }
  }

  // Default to 'chat' if no rules matched
  if (capabilities.size === 0) {
    capabilities.add('chat');
  }

  return Array.from(capabilities);
}

/**
 * Check if a model supports chat completion (can be used as an agent brain).
 *
 * Models without 'chat' capability (video, image, audio, embedding only)
 * cannot be used for agent task types like planning, execution, etc.
 */
export function isAgentCapableModel(modelName: string): boolean {
  const caps = detectModelCapabilities(modelName);
  return caps.includes('chat');
}

/**
 * Check if a model is a non-chat model (video, image, audio, embedding).
 *
 * Inverse of isAgentCapableModel. Used by the backend test endpoint
 * to decide whether to use Models List API vs. Chat Completions API.
 */
export function isNonChatModel(modelName: string): boolean {
  return !isAgentCapableModel(modelName);
}

/**
 * Get the primary capability of a model (the "most important" one).
 *
 * Returns the first capability in the display order that the model has.
 * Useful for grouping or primary icon display.
 */
export function getPrimaryCapability(modelName: string): ModelCapability {
  const caps = detectModelCapabilities(modelName);
  for (const cap of CAPABILITY_DISPLAY_ORDER) {
    if (caps.includes(cap)) return cap;
  }
  return 'chat';
}

// ============================================================================
// Speech-Specific Detection Patterns
// ============================================================================

/** Well-known TTS model name patterns */
const TTS_MODEL_PATTERNS: RegExp[] = [
  /^tts-/i,
  /^gpt-4o-mini-tts/i,
  /^aura[-_]/i,
  /^eleven[-_]/i,
  /^sonic[-_]/i,
  /^kokoro/i,
  /^piper/i,
  /^bark/i,
  /^xtts/i,
  /^parler[-_]tts/i,
  /^metavoice/i,
  /^chatterbox/i,
  /^chattts/i,
  /^fish[-_]speech/i,
  /^orpheus/i,
  /^voxtral/i,
  /gemini.*tts/i,
];

/** Well-known STT model name patterns */
const STT_MODEL_PATTERNS: RegExp[] = [
  /^whisper/i,
  /^gpt-4o-transcribe/i,
  /^gpt-4o-mini-transcribe/i,
  /^nova[-_]?[23]/i,
  /^deepgram/i,
  /^sensevoice/i,
  /^scribe/i, // ElevenLabs Scribe STT
];

/**
 * Check if a model name is a known TTS model.
 * Used by the speech settings UI to identify which providers can do TTS.
 */
export function isTTSModel(modelName: string): boolean {
  const name = modelName.includes('/')
    ? modelName.split('/').pop()!
    : modelName;
  return TTS_MODEL_PATTERNS.some((p) => p.test(name));
}

/**
 * Check if a model name is a known STT model.
 * Used by the speech settings UI to identify which providers can do STT.
 */
export function isSTTModel(modelName: string): boolean {
  const name = modelName.includes('/')
    ? modelName.split('/').pop()!
    : modelName;
  return STT_MODEL_PATTERNS.some((p) => p.test(name));
}

/**
 * Check if a model has any speech capability (TTS or STT).
 */
export function isSpeechModel(modelName: string): boolean {
  return isTTSModel(modelName) || isSTTModel(modelName);
}
