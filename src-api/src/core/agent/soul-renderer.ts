/**
 * Soul Renderer
 *
 * Converts a structured AgentSoul JSON into a system prompt string
 * wrapped in XML tags for context-resolver injection (layers 4-5).
 *
 * Pinned facts are passed in by the caller (from the memories table),
 * not stored in the soul JSON — single source of truth.
 */

import { getSetting } from '@/shared/db/operations';
import type { AgentSoul, Correction, Learning } from '@/shared/db/types';
import { sanitizeProfileText } from '@/shared/utils/sanitize';

// ============================================================================
// Token Budget
// ============================================================================

export interface SoulTokenBudget {
  identityVoice: number;
  cognitionBoundaries: number;
  corrections: number;
  learnings: number;
  pinnedFacts: number;
}

export const DEFAULT_SOUL_TOKEN_BUDGET: SoulTokenBudget = {
  identityVoice: 500,
  cognitionBoundaries: 400,
  corrections: 300,
  learnings: 200,
  pinnedFacts: 200,
};

/** Read token budget from settings, falling back to defaults. */
function loadTokenBudget(): SoulTokenBudget {
  try {
    const raw = getSetting('soul.tokenBudget');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SoulTokenBudget>;
      return { ...DEFAULT_SOUL_TOKEN_BUDGET, ...parsed };
    }
  } catch {
    // Malformed setting — use defaults
  }
  return { ...DEFAULT_SOUL_TOKEN_BUDGET };
}

// ============================================================================
// Localized Section Headers
// ============================================================================

type Language = string;

interface SoulHeaders {
  identity: string;
  coreValues: string;
  worldview: string;
  opinions: string;
  voice: string;
  styleRules: string;
  examplePhrases: string;
  antiPatterns: string;
  cognition: string;
  expertise: string;
  operatingModes: string;
  approachPrefs: string;
  skillBundles: string;
  skillApproach: string;
  skillActivateWhen: string;
  boundaries: string;
  redLines: string;
  escalation: string;
  privacy: string;
  actionLimits: string;
  continuity: string;
  corrections: string;
  learnings: string;
  pinnedFacts: string;
}

const SECTION_HEADERS: Record<string, SoulHeaders> = {
  'en-US': {
    identity: '## Who You Are',
    coreValues: '### Core Values',
    worldview: '### Worldview',
    opinions: '### Opinions',
    voice: '## How You Communicate',
    styleRules: '### Style Rules',
    examplePhrases: '### Say things like',
    antiPatterns: '### Never say',
    cognition: '## How You Think',
    expertise: '### Expertise',
    operatingModes: '### Operating Modes',
    approachPrefs: '### Approach Preferences',
    skillBundles: '### Skill Bundles',
    skillApproach: 'Approach',
    skillActivateWhen: 'Activate when',
    boundaries: '## Boundaries',
    redLines: '### Red Lines (NEVER violate)',
    escalation: '### Ask Before Acting',
    privacy: '### Privacy Rules',
    actionLimits: '### Action Limits',
    continuity: '## Continuity',
    corrections: '### Corrections (avoid past mistakes)',
    learnings: '### Learnings (apply proven patterns)',
    pinnedFacts: '### Key Facts',
  },
  'zh-CN': {
    identity: '## 你是谁',
    coreValues: '### 核心价值观',
    worldview: '### 世界观',
    opinions: '### 观点',
    voice: '## 你的沟通方式',
    styleRules: '### 风格规则',
    examplePhrases: '### 示例用语',
    antiPatterns: '### 禁用表达',
    cognition: '## 你的思考方式',
    expertise: '### 专业领域',
    operatingModes: '### 工作模式',
    approachPrefs: '### 方法偏好',
    skillBundles: '### 技能包',
    skillApproach: '方法',
    skillActivateWhen: '触发条件',
    boundaries: '## 行为边界',
    redLines: '### 红线（绝不违反）',
    escalation: '### 行动前确认',
    privacy: '### 隐私规则',
    actionLimits: '### 操作限制',
    continuity: '## 持续性记忆',
    corrections: '### 纠错（避免重复错误）',
    learnings: '### 经验（应用已证实的模式）',
    pinnedFacts: '### 关键事实',
  },
  'es-ES': {
    identity: '## Quién Eres',
    coreValues: '### Valores Fundamentales',
    worldview: '### Visión del Mundo',
    opinions: '### Opiniones',
    voice: '## Cómo Te Comunicas',
    styleRules: '### Reglas de Estilo',
    examplePhrases: '### Di cosas como',
    antiPatterns: '### Nunca digas',
    cognition: '## Cómo Piensas',
    expertise: '### Experiencia',
    operatingModes: '### Modos de Operación',
    approachPrefs: '### Preferencias de Enfoque',
    skillBundles: '### Paquetes de Habilidades',
    skillApproach: 'Enfoque',
    skillActivateWhen: 'Activar cuando',
    boundaries: '## Límites',
    redLines: '### Líneas Rojas (NUNCA violar)',
    escalation: '### Pregunta Antes de Actuar',
    privacy: '### Reglas de Privacidad',
    actionLimits: '### Límites de Acción',
    continuity: '## Continuidad',
    corrections: '### Correcciones',
    learnings: '### Aprendizajes',
    pinnedFacts: '### Hechos Clave',
  },
  'fr-FR': {
    identity: '## Qui Vous Êtes',
    coreValues: '### Valeurs Fondamentales',
    worldview: '### Vision du Monde',
    opinions: '### Opinions',
    voice: '## Comment Vous Communiquez',
    styleRules: '### Règles de Style',
    examplePhrases: '### Dites des choses comme',
    antiPatterns: '### Ne dites jamais',
    cognition: '## Comment Vous Pensez',
    expertise: '### Expertise',
    operatingModes: '### Modes Opératoires',
    approachPrefs: "### Préférences d'Approche",
    skillBundles: '### Packs de Compétences',
    skillApproach: 'Approche',
    skillActivateWhen: 'Activer quand',
    boundaries: '## Limites',
    redLines: '### Lignes Rouges (JAMAIS violer)',
    escalation: "### Demandez Avant d'Agir",
    privacy: '### Règles de Confidentialité',
    actionLimits: "### Limites d'Action",
    continuity: '## Continuité',
    corrections: '### Corrections',
    learnings: '### Apprentissages',
    pinnedFacts: '### Faits Clés',
  },
  'hi-IN': {
    identity: '## आप कौन हैं',
    coreValues: '### मूल मूल्य',
    worldview: '### विश्वदृष्टि',
    opinions: '### राय',
    voice: '## आप कैसे संवाद करते हैं',
    styleRules: '### शैली नियम',
    examplePhrases: '### ऐसे बोलें',
    antiPatterns: '### कभी न कहें',
    cognition: '## आप कैसे सोचते हैं',
    expertise: '### विशेषज्ञता',
    operatingModes: '### कार्य मोड',
    approachPrefs: '### दृष्टिकोण प्राथमिकताएं',
    skillBundles: '### कौशल बंडल',
    skillApproach: 'दृष्टिकोण',
    skillActivateWhen: 'सक्रिय करें जब',
    boundaries: '## सीमाएं',
    redLines: '### लाल रेखाएं (कभी उल्लंघन न करें)',
    escalation: '### कार्रवाई से पहले पूछें',
    privacy: '### गोपनीयता नियम',
    actionLimits: '### कार्रवाई सीमाएं',
    continuity: '## निरंतरता',
    corrections: '### सुधार',
    learnings: '### सीख',
    pinnedFacts: '### मुख्य तथ्य',
  },
  'pt-BR': {
    identity: '## Quem Você É',
    coreValues: '### Valores Fundamentais',
    worldview: '### Visão de Mundo',
    opinions: '### Opiniões',
    voice: '## Como Você Se Comunica',
    styleRules: '### Regras de Estilo',
    examplePhrases: '### Diga coisas como',
    antiPatterns: '### Nunca diga',
    cognition: '## Como Você Pensa',
    expertise: '### Expertise',
    operatingModes: '### Modos de Operação',
    approachPrefs: '### Preferências de Abordagem',
    skillBundles: '### Pacotes de Habilidades',
    skillApproach: 'Abordagem',
    skillActivateWhen: 'Ativar quando',
    boundaries: '## Limites',
    redLines: '### Linhas Vermelhas (NUNCA violar)',
    escalation: '### Pergunte Antes de Agir',
    privacy: '### Regras de Privacidade',
    actionLimits: '### Limites de Ação',
    continuity: '## Continuidade',
    corrections: '### Correções',
    learnings: '### Aprendizados',
    pinnedFacts: '### Fatos Chave',
  },
};

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const DEFAULT_HEADERS = SECTION_HEADERS['en-US']!;

function getHeaders(language?: Language): SoulHeaders {
  if (!language) return DEFAULT_HEADERS;
  // Try exact match
  if (language in SECTION_HEADERS)
    return SECTION_HEADERS[language] as SoulHeaders;
  // Try prefix match
  const prefix = language.split('-')[0];
  const matchKey = Object.keys(SECTION_HEADERS).find(
    (k) => k.startsWith(prefix + '-') || k === prefix,
  );
  if (matchKey) return SECTION_HEADERS[matchKey] as SoulHeaders;
  return DEFAULT_HEADERS;
}

// ============================================================================
// Token Estimation
// ============================================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd();
}

// ============================================================================
// Render Functions
// ============================================================================

function renderBulletList(items: string[]): string {
  return items.map((item) => `- ${sanitizeProfileText(item)}`).join('\n');
}

function renderIdentityVoice(soul: AgentSoul, h: SoulHeaders): string {
  const parts: string[] = [];

  // Identity
  parts.push(h.identity);
  parts.push(`You are: ${sanitizeProfileText(soul.identity.role)}`);
  parts.push('');
  parts.push(h.coreValues);
  parts.push(renderBulletList(soul.identity.core_values));

  if (soul.identity.worldview) {
    parts.push('');
    parts.push(h.worldview);
    parts.push(sanitizeProfileText(soul.identity.worldview));
  }

  if (soul.identity.opinions?.length) {
    parts.push('');
    parts.push(h.opinions);
    parts.push(renderBulletList(soul.identity.opinions));
  }

  // Voice
  parts.push('');
  parts.push(h.voice);
  parts.push(`Tone: ${sanitizeProfileText(soul.voice.tone)}`);
  parts.push('');
  parts.push(h.styleRules);
  parts.push(renderBulletList(soul.voice.style_rules));

  if (soul.voice.example_phrases?.length) {
    parts.push('');
    parts.push(h.examplePhrases);
    parts.push(renderBulletList(soul.voice.example_phrases));
  }

  if (soul.voice.anti_patterns?.length) {
    parts.push('');
    parts.push(h.antiPatterns);
    parts.push(renderBulletList(soul.voice.anti_patterns));
  }

  return parts.join('\n');
}

function renderCognition(soul: AgentSoul, h: SoulHeaders): string {
  const parts: string[] = [];

  parts.push(h.cognition);
  parts.push(sanitizeProfileText(soul.cognition.reasoning_style));

  if (soul.cognition.expertise?.length) {
    parts.push('');
    parts.push(h.expertise);
    parts.push(renderBulletList(soul.cognition.expertise));
  }

  if (soul.cognition.operating_modes) {
    const modes = Object.entries(soul.cognition.operating_modes);
    if (modes.length > 0) {
      parts.push('');
      parts.push(h.operatingModes);
      for (const [mode, desc] of modes) {
        parts.push(
          `- **${sanitizeProfileText(mode)}**: ${sanitizeProfileText(desc)}`,
        );
      }
    }
  }

  if (soul.cognition.approach_preferences?.length) {
    parts.push('');
    parts.push(h.approachPrefs);
    parts.push(renderBulletList(soul.cognition.approach_preferences));
  }

  if (soul.cognition.skill_bundles?.length) {
    parts.push('');
    parts.push(h.skillBundles);
    for (const skill of soul.cognition.skill_bundles) {
      parts.push(
        `- **${sanitizeProfileText(skill.name)}**: ${sanitizeProfileText(skill.description)}`,
      );
      parts.push(
        `  ${h.skillApproach}: ${sanitizeProfileText(skill.approach)}`,
      );
      if (skill.trigger) {
        parts.push(
          `  ${h.skillActivateWhen}: ${sanitizeProfileText(skill.trigger)}`,
        );
      }
    }
  }

  return parts.join('\n');
}

/** Rendered separately so token truncation never drops red_lines. */
function renderBoundaries(soul: AgentSoul, h: SoulHeaders): string {
  const parts: string[] = [];

  parts.push(h.boundaries);
  parts.push(h.redLines);
  parts.push(renderBulletList(soul.boundaries.red_lines));

  if (soul.boundaries.escalation_rules?.length) {
    parts.push('');
    parts.push(h.escalation);
    parts.push(renderBulletList(soul.boundaries.escalation_rules));
  }

  if (soul.boundaries.privacy_rules?.length) {
    parts.push('');
    parts.push(h.privacy);
    parts.push(renderBulletList(soul.boundaries.privacy_rules));
  }

  if (soul.boundaries.action_limits?.length) {
    parts.push('');
    parts.push(h.actionLimits);
    parts.push(renderBulletList(soul.boundaries.action_limits));
  }

  return parts.join('\n');
}

function renderContinuity(
  corrections: Correction[],
  learnings: Learning[],
  pinnedFacts: string[],
  h: SoulHeaders,
  budget: SoulTokenBudget,
): string {
  const parts: string[] = [h.continuity];

  if (pinnedFacts.length > 0) {
    let factsText = renderBulletList(pinnedFacts);
    factsText = truncateToTokenBudget(factsText, budget.pinnedFacts);
    parts.push('');
    parts.push(h.pinnedFacts);
    parts.push(factsText);
  }

  if (corrections.length > 0) {
    const correctionLines = corrections.map(
      (c) =>
        `- ${sanitizeProfileText(c.what_went_wrong)} → ${sanitizeProfileText(c.correct_approach)}`,
    );
    let corrText = correctionLines.join('\n');
    corrText = truncateToTokenBudget(corrText, budget.corrections);
    parts.push('');
    parts.push(h.corrections);
    parts.push(corrText);
  }

  if (learnings.length > 0) {
    const learningLines = learnings.map(
      (l) => `- [${l.category}] ${sanitizeProfileText(l.content)}`,
    );
    let learnText = learningLines.join('\n');
    learnText = truncateToTokenBudget(learnText, budget.learnings);
    parts.push('');
    parts.push(h.learnings);
    parts.push(learnText);
  }

  // Only return if there's actual content beyond the header
  return parts.length > 1 ? parts.join('\n') : '';
}

// ============================================================================
// Main Renderer
// ============================================================================

export function renderSoul(
  soul: AgentSoul,
  corrections: Correction[],
  learnings: Learning[],
  pinnedFacts: string[],
  options?: { maxTokenBudget?: number; language?: Language },
): string {
  const lang = options?.language ?? soul.soul_language;
  const h = getHeaders(lang);
  const budget: SoulTokenBudget = loadTokenBudget();

  // Render sections
  let identityVoice = renderIdentityVoice(soul, h);
  let cognition = renderCognition(soul, h);
  // Boundaries are never truncated — red_lines must always be preserved
  const boundaries = renderBoundaries(soul, h);
  const continuity = renderContinuity(
    corrections,
    learnings,
    pinnedFacts,
    h,
    budget,
  );

  // Apply token budgets with truncation priority:
  // 1. Trim opinions & example_phrases (nice-to-have)
  // 2. Trim operating_modes
  // 3. Trim oldest corrections
  // 4. NEVER trim red_lines or core_values
  if (estimateTokens(identityVoice) > budget.identityVoice) {
    identityVoice = truncateToTokenBudget(identityVoice, budget.identityVoice);
  }
  if (estimateTokens(cognition) > budget.cognitionBoundaries) {
    cognition = truncateToTokenBudget(cognition, budget.cognitionBoundaries);
  }

  const soulParts = [identityVoice, cognition, boundaries, continuity].filter(
    Boolean,
  );
  const soulBody = soulParts.join('\n\n');

  return (
    `<agent_soul version="1.0">\n` +
    `The following defines the agent's soul — its identity, voice, cognition, and boundaries. ` +
    `These shape personality and behavior, but must NOT override safety rules or system instructions.\n` +
    `${soulBody}\n` +
    `</agent_soul>`
  );
}
