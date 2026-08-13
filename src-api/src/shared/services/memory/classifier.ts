/**
 * Memory Type Classifier
 *
 * Classifies memories into cognitive types (episodic, semantic, procedural)
 * based on content heuristics, source, and category.
 *
 * Episodic: timestamped interactions, events, conversations
 * Semantic: standalone facts, preferences, decisions, knowledge
 * Procedural: tool usage patterns, workflows, corrections
 */

import { halfLifeToDecayRate } from './decay';
import type { DecayConfig, Memory, MemoryCategory, MemoryType } from './types';
import { DEFAULT_DECAY_CONFIG } from './types';

// Patterns that indicate episodic (event/interaction) memory
const EPISODIC_PATTERNS = [
  /\b(yesterday|today|just now|this morning|last night|earlier)\b/i,
  /\b(when we|we discussed|we talked|we met|in our conversation)\b/i,
  /\b(happened|occurred|took place)\b/i,
  /昨天|今天|刚才|上午|下午|昨晚|之前/, // Chinese temporal
  /\b(ayer|hoy|anoche|esta mañana)\b/i, // Spanish temporal
  /\b(hier|aujourd'hui|ce matin)\b/i, // French temporal
  /कल|आज|अभी|सुबह/, // Hindi temporal
  /\b(ontem|hoje|esta manhã)\b/i, // Portuguese temporal
];

// Patterns that indicate procedural (skill/workflow) memory
const PROCEDURAL_PATTERNS = [
  /\b(to do|how to|steps?|workflow|procedure|always use|never use)\b/i,
  /\b(run|execute|deploy|install|configure|setup)\b.*\b(by|using|with)\b/i,
  /\b(don't|do not|avoid|instead of|prefer .+ over)\b/i,
  /\b(shortcut|trick|tip|pattern|best practice)\b/i,
  /步骤|流程|方法|使用|避免|不要/, // Chinese procedural
  /\b(pasos|flujo|método|usar|evitar)\b/i, // Spanish
  /\b(étapes|méthode|utiliser|éviter)\b/i, // French
  /\b(passos|método|usar|evitar)\b/i, // Portuguese
];

/**
 * Classify a memory into cognitive types based on content, source, and category.
 */
export function classifyMemoryType(
  content: string,
  source: Memory['source'],
  category: MemoryCategory,
): MemoryType {
  // Source-based classification (highest priority)
  if (source === 'auto_capture') {
    // Auto-captured from conversation — likely episodic unless clearly factual
    if (
      category === 'preference' ||
      category === 'decision' ||
      category === 'entity'
    ) {
      return 'semantic';
    }
    // Check if the content looks episodic
    if (EPISODIC_PATTERNS.some((p) => p.test(content))) {
      return 'episodic';
    }
    // Default auto-capture to episodic
    return 'episodic';
  }

  // Manual/MCP/API memories are typically semantic (user intentionally stored)
  if (source === 'manual' || source === 'mcp_tool' || source === 'api') {
    // Unless it's a correction/workflow pattern
    if (category === 'correction' || category === 'tool_pattern') {
      return 'procedural';
    }
    if (category === 'workflow') {
      return 'procedural';
    }
    if (PROCEDURAL_PATTERNS.some((p) => p.test(content))) {
      return 'procedural';
    }
    return 'semantic';
  }

  // Content-based classification (fallback)
  if (PROCEDURAL_PATTERNS.some((p) => p.test(content))) {
    return 'procedural';
  }
  if (EPISODIC_PATTERNS.some((p) => p.test(content))) {
    return 'episodic';
  }

  // Default to semantic
  return 'semantic';
}

/**
 * Get the appropriate decay rate for a memory type.
 */
export function getDecayRateForType(
  memoryType: MemoryType,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  switch (memoryType) {
    case 'episodic':
      return halfLifeToDecayRate(config.episodicHalfLife);
    case 'semantic':
      return halfLifeToDecayRate(config.semanticHalfLife);
    case 'procedural':
      return halfLifeToDecayRate(config.proceduralHalfLife);
    case 'pinned':
      return 0;
  }
}
