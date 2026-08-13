/**
 * AutomationTemplateGallery
 *
 * Quick-start templates for common automation patterns.
 * Each template pre-fills the create dialog.
 */

import {
  BarChart3,
  Bell,
  Calendar,
  GitPullRequest,
  Mail,
  Newspaper,
  Search,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { CreateAutomationInput } from '@/shared/types/automation';

// ─── Template definitions ──────────────────────────────────────────────────────

interface AutomationTemplate {
  id: string;
  icon: typeof Bell;
  nameKey: string;
  descriptionKey: string;
  preset: Partial<CreateAutomationInput>;
}

const TEMPLATES: AutomationTemplate[] = [
  {
    id: 'daily-standup',
    icon: Calendar,
    nameKey: 'templateDailyStandupName',
    descriptionKey: 'templateDailyStandupDesc',
    preset: {
      name: 'Daily Standup Summary',
      prompt:
        'Summarize the work done today from the session transcripts. List completed tasks, blockers, and plans for tomorrow in a concise standup format.',
      trigger: {
        type: 'cron',
        schedule: { kind: 'cron', cronExpr: '0 18 * * 1-5' },
      },
    },
  },
  {
    id: 'weekly-report',
    icon: BarChart3,
    nameKey: 'templateWeeklyReportName',
    descriptionKey: 'templateWeeklyReportDesc',
    preset: {
      name: 'Weekly Progress Report',
      prompt:
        'Generate a structured weekly progress report. Include completed milestones, metrics, upcoming goals, and any risks or blockers.',
      trigger: {
        type: 'cron',
        schedule: { kind: 'cron', cronExpr: '0 9 * * 1' },
      },
    },
  },
  {
    id: 'pr-digest',
    icon: GitPullRequest,
    nameKey: 'templatePrDigestName',
    descriptionKey: 'templatePrDigestDesc',
    preset: {
      name: 'PR Review Digest',
      prompt:
        'Check open pull requests in the repository and provide a summary of PRs needing review, their status, and any blocking issues.',
      trigger: {
        type: 'cron',
        schedule: { kind: 'cron', cronExpr: '0 10 * * 1-5' },
      },
    },
  },
  {
    id: 'news-monitor',
    icon: Newspaper,
    nameKey: 'templateNewsMonitorName',
    descriptionKey: 'templateNewsMonitorDesc',
    preset: {
      name: 'Tech News Monitor',
      prompt:
        'Search for the latest news in AI, developer tools, and the tech industry. Summarize the top 5 most relevant stories with links.',
      trigger: {
        type: 'cron',
        schedule: { kind: 'cron', cronExpr: '0 8 * * *' },
      },
    },
  },
  {
    id: 'email-digest',
    icon: Mail,
    nameKey: 'templateEmailDigestName',
    descriptionKey: 'templateEmailDigestDesc',
    preset: {
      name: 'Email Digest',
      prompt:
        'Review my emails from the past 24 hours. Summarize urgent messages, action items, and anything requiring a response.',
      trigger: {
        type: 'cron',
        schedule: { kind: 'cron', cronExpr: '0 7 * * *' },
      },
    },
  },
  {
    id: 'research-alert',
    icon: Search,
    nameKey: 'templateResearchAlertName',
    descriptionKey: 'templateResearchAlertDesc',
    preset: {
      name: 'Research Alert',
      prompt:
        'Search for new papers, blog posts, or announcements related to [your topic]. Summarize findings and flag anything important.',
      trigger: {
        type: 'cron',
        schedule: { kind: 'cron', cronExpr: '0 12 * * *' },
      },
    },
  },
  {
    id: 'on-webhook',
    icon: Bell,
    nameKey: 'templateWebhookTriggerName',
    descriptionKey: 'templateWebhookTriggerDesc',
    preset: {
      name: 'Webhook Automation',
      prompt:
        'Process the incoming webhook payload and perform the required action.',
      trigger: {
        type: 'webhook',
        webhook: { slug: '', token: '' },
      },
    },
  },
];

// ─── Component ─────────────────────────────────────────────────────────────────

interface AutomationTemplateGalleryProps {
  onSelect: (preset: Partial<CreateAutomationInput>) => void;
}

export function AutomationTemplateGallery({
  onSelect,
}: AutomationTemplateGalleryProps) {
  const { t } = useLanguage();
  const at = t.automation as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {(at.templateGalleryDesc as string) ??
          'Start from a template or create from scratch.'}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((tpl) => {
          const Icon = tpl.icon;
          const name = (at[tpl.nameKey] as string) ?? tpl.nameKey;
          const desc = (at[tpl.descriptionKey] as string) ?? tpl.descriptionKey;
          return (
            <button
              key={tpl.id}
              onClick={() => onSelect(tpl.preset)}
              className="border-border hover:bg-accent/40 flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <span className="text-foreground text-sm font-medium">
                  {name}
                </span>
              </div>
              <p className="text-muted-foreground line-clamp-2 text-xs">
                {desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
