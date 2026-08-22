/**
 * Auto-mode Safety Classifier
 *
 * An independent AI model (Haiku) that reviews tool calls for safety.
 * Provides defense-in-depth by acting as a second opinion separate from
 * the agent that decided to make the tool call.
 *
 * Two-stage classification:
 * - Stage 1 (fast): Simple yes/no, 50 tokens, 2s timeout
 * - Stage 2 (deep): Chain-of-thought, 500 tokens, 5s timeout — only if Stage 1 is ambiguous
 *
 * Feature-flagged: off by default. Enable via settings.
 * Cost: ~$0.001 per classification (Haiku), ~$0.01 per task at 10 tool calls.
 */

import Anthropic from '@anthropic-ai/sdk';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AutoClassifier');

export interface ClassifierResult {
  decision: 'allow' | 'deny' | 'warn';
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a safety classifier for an AI agent's tool calls. You review each tool call independently.
The agent is NOT you — you are a separate reviewer. Your job is to identify potentially dangerous operations.

Categories of concern:
- Destructive file operations (delete, overwrite critical files)
- Credential or secret exposure
- System modification (permissions, services)
- Network exfiltration (sending local data to external URLs)
- Infinite loops or resource exhaustion

If the operation is clearly safe for a development workspace: allow.
If uncertain: warn (let the user decide).
If clearly dangerous: deny.`;

const STAGE1_PROMPT = `Tool: {toolName}
Input: {toolInput}

Is this tool call safe? Answer with exactly one word: ALLOW, WARN, or DENY.`;

const STAGE2_PROMPT = `Tool: {toolName}
Input: {toolInput}
Context: {context}

Analyze this tool call for safety. Consider:
1. What does this operation do?
2. Could it cause irreversible damage?
3. Does it expose sensitive data?
4. Is it consistent with normal development work?

Respond with a JSON object: { "decision": "allow"|"deny"|"warn", "confidence": 0.0-1.0, "reasoning": "brief explanation" }`;

/** Max cached classification results per session */
const MAX_CACHE_SIZE = 500;

export class AutoClassifier {
  private client: Anthropic;
  private model: string;
  private cache = new Map<string, ClassifierResult>();

  constructor(apiKey: string, model = 'claude-haiku-4-5') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /**
   * Classify a tool call for safety using two-stage approach.
   */
  async classify(
    toolName: string,
    toolInput: unknown,
    context?: string,
  ): Promise<ClassifierResult> {
    const cacheKey = `${toolName}:${JSON.stringify(toolInput)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      // Stage 1: Fast classification
      const stage1Result = await this.stage1(toolName, toolInput);

      if (stage1Result.decision !== 'warn' || stage1Result.confidence > 0.8) {
        this.cacheSet(cacheKey, stage1Result);
        return stage1Result;
      }

      // Stage 2: Deep classification (only if Stage 1 is ambiguous)
      const stage2Result = await this.stage2(toolName, toolInput, context);
      this.cacheSet(cacheKey, stage2Result);
      return stage2Result;
    } catch (err) {
      // Fallback: never block on classifier failure
      logger.warn('Classifier failed, defaulting to warn:', err);
      const fallback: ClassifierResult = {
        decision: 'warn',
        confidence: 0,
        reasoning: 'Classifier unavailable — defaulting to user review',
      };
      return fallback;
    }
  }

  /**
   * Stage 1: Fast yes/no classification. Max 50 tokens, 2s timeout.
   */
  private async stage1(
    toolName: string,
    toolInput: unknown,
  ): Promise<ClassifierResult> {
    const inputStr =
      typeof toolInput === 'object'
        ? JSON.stringify(toolInput).slice(0, 500)
        : String(toolInput).slice(0, 500);

    const prompt = STAGE1_PROMPT.replace('{toolName}', toolName).replace(
      '{toolInput}',
      inputStr,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 50,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal },
      );

      const text =
        response.content[0]?.type === 'text'
          ? response.content[0].text.trim().toUpperCase()
          : '';

      if (text.includes('ALLOW')) {
        return {
          decision: 'allow',
          confidence: 0.9,
          reasoning: 'Stage 1: classified as safe',
        };
      } else if (text.includes('DENY')) {
        return {
          decision: 'deny',
          confidence: 0.9,
          reasoning: 'Stage 1: classified as dangerous',
        };
      } else {
        return {
          decision: 'warn',
          confidence: 0.5,
          reasoning: 'Stage 1: ambiguous — escalating to deep review',
        };
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Stage 2: Deep chain-of-thought classification. Max 500 tokens, 5s timeout.
   */
  private async stage2(
    toolName: string,
    toolInput: unknown,
    context?: string,
  ): Promise<ClassifierResult> {
    const inputStr =
      typeof toolInput === 'object'
        ? JSON.stringify(toolInput).slice(0, 1000)
        : String(toolInput).slice(0, 1000);

    const prompt = STAGE2_PROMPT.replace('{toolName}', toolName)
      .replace('{toolInput}', inputStr)
      .replace('{context}', context || 'No additional context');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal },
      );

      const text =
        response.content[0]?.type === 'text'
          ? response.content[0].text.trim()
          : '';

      // Try to parse JSON response
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            decision: ['allow', 'deny', 'warn'].includes(parsed.decision)
              ? parsed.decision
              : 'warn',
            confidence:
              typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
            reasoning:
              typeof parsed.reasoning === 'string'
                ? parsed.reasoning
                : 'Stage 2 deep review',
          };
        }
      } catch {
        // JSON parse failed — fall through
      }

      // Fallback: parse text for decision keywords
      const upper = text.toUpperCase();
      if (upper.includes('DENY')) {
        return {
          decision: 'deny',
          confidence: 0.7,
          reasoning: text.slice(0, 200),
        };
      } else if (upper.includes('ALLOW')) {
        return {
          decision: 'allow',
          confidence: 0.7,
          reasoning: text.slice(0, 200),
        };
      }
      return {
        decision: 'warn',
        confidence: 0.5,
        reasoning: text.slice(0, 200),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Clear the classification cache (e.g., between sessions). */
  clearCache(): void {
    this.cache.clear();
  }

  /** Bounded cache setter — evicts oldest entry when full. */
  private cacheSet(key: string, value: ClassifierResult): void {
    if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(key)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }
}
