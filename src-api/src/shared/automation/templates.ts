/**
 * Automation Templates
 *
 * Predefined templates for common scheduling patterns.
 * Template names and descriptions use locale keys so the frontend
 * can render them in the user's language via useLanguage().
 */

import type {
  AutomationChannelDelivery,
  AutomationCondition,
  AutomationSchedule,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface AutomationTemplate {
  id: string;
  /** Locale key for display name (resolved by frontend i18n) */
  nameKey: string;
  /** Locale key for description */
  descriptionKey: string;
  /** Locale key for the default prompt */
  promptKey: string;
  /** Icon identifier for the template */
  icon: string;
  /** Template category */
  category: 'monitoring' | 'reporting' | 'maintenance' | 'notification';
  /** Default schedule configuration */
  schedule: AutomationSchedule;
  /** Default delivery configuration */
  delivery: Partial<AutomationChannelDelivery>;
  /** Optional condition for check-and-notify */
  condition?: AutomationCondition;
  /** Suggested expiry in days */
  suggestedExpiry?: number;
  /** Suggested cost budget in USD */
  suggestedBudget?: number;
  /** Required MCP servers */
  requiredMcp?: string[];
}

// ============================================================================
// Built-in Templates
// ============================================================================

export const BUILT_IN_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'daily-news-brief',
    nameKey: 'automation.templateNewsMonitorName',
    descriptionKey: 'automation.templateNewsMonitorDesc',
    promptKey: 'automation.templateNewsMonitorPrompt',
    icon: 'newspaper',
    category: 'reporting',
    schedule: { kind: 'cron', cronExpr: '0 8 * * *' },
    delivery: { suppressEmpty: true, format: 'markdown' },
    suggestedBudget: 5,
  },
  {
    id: 'price-monitor',
    nameKey: 'automation.templatePriceMonitorName',
    descriptionKey: 'automation.templatePriceMonitorDesc',
    promptKey: 'automation.templatePriceMonitorPrompt',
    icon: 'tag',
    category: 'monitoring',
    schedule: { kind: 'cron', cronExpr: '0 */4 * * *' },
    delivery: { suppressEmpty: true },
    condition: { description: 'price drops below target', mode: 'llm_judge' },
    suggestedExpiry: 30,
    suggestedBudget: 10,
  },
  {
    id: 'ci-cd-status',
    nameKey: 'automation.templateCiStatusName',
    descriptionKey: 'automation.templateCiStatusDesc',
    promptKey: 'automation.templateCiStatusPrompt',
    icon: 'git-branch',
    category: 'monitoring',
    schedule: { kind: 'cron', cronExpr: '0 */2 * * 1-5' },
    delivery: { suppressEmpty: true },
    condition: {
      description: 'build failure or deployment issue detected',
      mode: 'llm_judge',
    },
    suggestedBudget: 3,
  },
  {
    id: 'weekly-digest',
    nameKey: 'automation.templateWeeklyReportName',
    descriptionKey: 'automation.templateWeeklyReportDesc',
    promptKey: 'automation.templateWeeklyReportPrompt',
    icon: 'bar-chart',
    category: 'reporting',
    schedule: { kind: 'cron', cronExpr: '0 18 * * 0' },
    delivery: { suppressEmpty: false, format: 'markdown' },
    suggestedBudget: 5,
  },
  {
    id: 'pr-review-reminder',
    nameKey: 'automation.templatePrDigestName',
    descriptionKey: 'automation.templatePrDigestDesc',
    promptKey: 'automation.templatePrDigestPrompt',
    icon: 'git-pull-request',
    category: 'notification',
    schedule: { kind: 'cron', cronExpr: '0 10 * * 1-5' },
    delivery: { suppressEmpty: true },
    suggestedBudget: 3,
  },
  {
    id: 'dependency-audit',
    nameKey: 'automation.templateDependencyAuditName',
    descriptionKey: 'automation.templateDependencyAuditDesc',
    promptKey: 'automation.templateDependencyAuditPrompt',
    icon: 'shield',
    category: 'maintenance',
    schedule: { kind: 'cron', cronExpr: '0 9 * * 1' },
    delivery: { suppressEmpty: true },
    suggestedBudget: 2,
  },
  {
    id: 'daily-standup',
    nameKey: 'automation.templateDailyStandupName',
    descriptionKey: 'automation.templateDailyStandupDesc',
    promptKey: 'automation.templateDailyStandupPrompt',
    icon: 'users',
    category: 'reporting',
    schedule: { kind: 'cron', cronExpr: '0 18 * * 1-5' },
    delivery: { suppressEmpty: false, format: 'markdown' },
    suggestedBudget: 5,
  },
  {
    id: 'email-digest',
    nameKey: 'automation.templateEmailDigestName',
    descriptionKey: 'automation.templateEmailDigestDesc',
    promptKey: 'automation.templateEmailDigestPrompt',
    icon: 'mail',
    category: 'reporting',
    schedule: { kind: 'cron', cronExpr: '0 7 * * 1-5' },
    delivery: { suppressEmpty: true, format: 'summary' },
    suggestedBudget: 5,
    requiredMcp: ['google'],
  },
];

// ============================================================================
// Public API
// ============================================================================

/** Get all built-in templates */
export function getTemplates(): AutomationTemplate[] {
  return BUILT_IN_TEMPLATES;
}

/** Get a template by ID */
export function getTemplate(id: string): AutomationTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}
