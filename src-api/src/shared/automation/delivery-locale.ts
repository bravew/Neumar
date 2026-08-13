/**
 * Delivery Locale Templates
 *
 * Lightweight backend locale templates for automation delivery messages.
 * NOT a full i18n framework — just a Record<locale, Record<key, template>>
 * for system-generated messages that reach external channels.
 *
 * Each automation stores `locale: string` (captured at creation time).
 * The delivery router calls `renderTemplate(locale, key, params)`.
 * Fallback: en-US if locale not found.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DeliveryLocale');

// ============================================================================
// Types
// ============================================================================

export type DeliveryLocale =
  | 'en-US'
  | 'zh-CN'
  | 'es-ES'
  | 'fr-FR'
  | 'hi-IN'
  | 'pt-BR';

// ============================================================================
// Templates
// ============================================================================

const TEMPLATES: Record<DeliveryLocale, Record<string, string>> = {
  'en-US': {
    'run.header': '{status} {name} — {statusText} ({duration}{cost})',
    'run.footer': 'Next run: {nextRun}',
    expired:
      "Scheduled task '{name}' has expired. Ran {runCount} times over {days} days. Total cost: {totalCost}.",
    'budget.exhausted':
      "Automation '{name}' paused — cost budget ({budget}) reached. Total spent: {spent}.",
    'budget.global':
      'Daily automation budget ({budget}) reached. All automations paused until tomorrow.',
    'error.consecutive':
      "Automation '{name}' disabled after {count} consecutive failures. Last error: {error}",
    'condition.quiet':
      '{name}: condition not met ({quietCount} consecutive quiet runs)',
    created: "Schedule '{name}' configured — results will be delivered here.",
    'maxRuns.reached':
      "Automation '{name}' has reached its maximum of {maxRuns} runs and has been disabled.",
  },
  'zh-CN': {
    'run.header': '{status} {name} — {statusText}（{duration}{cost}）',
    'run.footer': '下次运行：{nextRun}',
    expired:
      '定时任务「{name}」已过期。在 {days} 天内运行了 {runCount} 次，总费用：{totalCost}。',
    'budget.exhausted':
      '自动化「{name}」已暂停 — 费用预算（{budget}）已用完，总支出：{spent}。',
    'budget.global': '每日自动化预算（{budget}）已用完，所有自动化暂停至明天。',
    'error.consecutive':
      '自动化「{name}」已停用，连续 {count} 次失败。最近错误：{error}',
    'condition.quiet': '{name}：条件未满足（连续 {quietCount} 次无通知）',
    created: '定时任务「{name}」已配置，结果将发送到这里。',
    'maxRuns.reached':
      '自动化「{name}」已达到最大运行次数 {maxRuns} 次，已自动停用。',
  },
  'es-ES': {
    'run.header': '{status} {name} — {statusText} ({duration}{cost})',
    'run.footer': 'Próxima ejecución: {nextRun}',
    expired:
      "La tarea programada '{name}' ha expirado. Se ejecutó {runCount} veces en {days} días. Costo total: {totalCost}.",
    'budget.exhausted':
      "Automatización '{name}' pausada — presupuesto ({budget}) agotado. Gasto total: {spent}.",
    'budget.global':
      'Presupuesto diario de automatización ({budget}) agotado. Todas las automatizaciones pausadas hasta mañana.',
    'error.consecutive':
      "Automatización '{name}' desactivada tras {count} fallos consecutivos. Último error: {error}",
    'condition.quiet':
      '{name}: condición no cumplida ({quietCount} ejecuciones consecutivas sin notificación)',
    created:
      "Tarea programada '{name}' configurada — los resultados se enviarán aquí.",
    'maxRuns.reached':
      "Automatización '{name}' ha alcanzado el máximo de {maxRuns} ejecuciones y ha sido desactivada.",
  },
  'fr-FR': {
    'run.header': '{status} {name} — {statusText} ({duration}{cost})',
    'run.footer': 'Prochaine exécution : {nextRun}',
    expired:
      "La tâche planifiée '{name}' a expiré. Exécutée {runCount} fois sur {days} jours. Coût total : {totalCost}.",
    'budget.exhausted':
      "Automatisation '{name}' mise en pause — budget ({budget}) atteint. Total dépensé : {spent}.",
    'budget.global':
      "Budget quotidien d'automatisation ({budget}) atteint. Toutes les automatisations suspendues jusqu'à demain.",
    'error.consecutive':
      "Automatisation '{name}' désactivée après {count} échecs consécutifs. Dernière erreur : {error}",
    'condition.quiet':
      '{name} : condition non remplie ({quietCount} exécutions calmes consécutives)',
    created:
      "Tâche planifiée '{name}' configurée — les résultats seront envoyés ici.",
    'maxRuns.reached':
      "Automatisation '{name}' a atteint le maximum de {maxRuns} exécutions et a été désactivée.",
  },
  'hi-IN': {
    'run.header': '{status} {name} — {statusText} ({duration}{cost})',
    'run.footer': 'अगला रन: {nextRun}',
    expired:
      "शेड्यूल किया गया कार्य '{name}' समाप्त हो गया है। {days} दिनों में {runCount} बार चला। कुल लागत: {totalCost}।",
    'budget.exhausted':
      "ऑटोमेशन '{name}' रोक दिया गया — बजट ({budget}) पूरा हो गया। कुल खर्च: {spent}।",
    'budget.global':
      'दैनिक ऑटोमेशन बजट ({budget}) पूरा हो गया। सभी ऑटोमेशन कल तक रोके गए।',
    'error.consecutive':
      "ऑटोमेशन '{name}' {count} लगातार विफलताओं के बाद अक्षम कर दिया गया। अंतिम त्रुटि: {error}",
    'condition.quiet': '{name}: शर्त पूरी नहीं हुई ({quietCount} लगातार शांत रन)',
    created: "शेड्यूल '{name}' कॉन्फ़िगर किया गया — परिणाम यहां भेजे जाएंगे।",
    'maxRuns.reached':
      "ऑटोमेशन '{name}' ने अधिकतम {maxRuns} रन पूरे कर लिए हैं और अक्षम कर दिया गया है।",
  },
  'pt-BR': {
    'run.header': '{status} {name} — {statusText} ({duration}{cost})',
    'run.footer': 'Próxima execução: {nextRun}',
    expired:
      "A tarefa agendada '{name}' expirou. Executada {runCount} vezes em {days} dias. Custo total: {totalCost}.",
    'budget.exhausted':
      "Automação '{name}' pausada — orçamento ({budget}) esgotado. Total gasto: {spent}.",
    'budget.global':
      'Orçamento diário de automação ({budget}) esgotado. Todas as automações pausadas até amanhã.',
    'error.consecutive':
      "Automação '{name}' desativada após {count} falhas consecutivas. Último erro: {error}",
    'condition.quiet':
      '{name}: condição não atendida ({quietCount} execuções calmas consecutivas)',
    created:
      "Agendamento '{name}' configurado — os resultados serão enviados aqui.",
    'maxRuns.reached':
      "Automação '{name}' atingiu o máximo de {maxRuns} execuções e foi desativada.",
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Render a locale template with parameter interpolation.
 * Falls back to en-US if locale or key is not found.
 */
export function renderTemplate(
  locale: string,
  key: string,
  params: Record<string, string | number>,
): string {
  // Normalize locale (accept "en", "zh", etc.)
  const normalized = normalizeLocale(locale);
  const templates = TEMPLATES[normalized] ?? TEMPLATES['en-US'];
  let template = templates[key] ?? TEMPLATES['en-US'][key];

  if (!template) {
    logger.warn('Missing delivery locale template', { locale, key });
    return `[${key}]`;
  }

  // Interpolate {param} placeholders
  for (const [k, v] of Object.entries(params)) {
    template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }

  return template;
}

/**
 * Normalize a locale string to our supported set.
 * Accepts short forms like "en", "zh", "es", etc.
 */
function normalizeLocale(locale: string): DeliveryLocale {
  const lower = locale.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('es')) return 'es-ES';
  if (lower.startsWith('fr')) return 'fr-FR';
  if (lower.startsWith('hi')) return 'hi-IN';
  if (lower.startsWith('pt')) return 'pt-BR';
  return 'en-US';
}
