/**
 * AutomationList
 *
 * List of all automations with filtering tabs and create button.
 */

import { useEffect, useMemo, useState } from 'react';

import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  Automation,
  AutomationTriggerType,
  CreateAutomationInput,
} from '@/shared/types/automation';

import { AutomationCard } from './AutomationCard';
import { AutomationCreateDialog } from './AutomationCreateDialog';
import { AutomationEmptyState } from './AutomationEmptyState';
import { AutomationTemplateGallery } from './AutomationTemplateGallery';

type FilterTab =
  | 'all'
  | 'active'
  | 'channel'
  | 'desktop'
  | AutomationTriggerType;

interface AutomationListProps {
  automations: Automation[];
  loading: boolean;
  onSelect: (automation: Automation) => void;
  onCreate: (input: CreateAutomationInput) => Promise<void>;
  onToggle: (id: string, enabled: boolean) => void;
  onTrigger: (id: string) => void;
  onDelete: (id: string) => void;
}

const FILTER_TABS: { id: FilterTab; labelKey: string }[] = [
  { id: 'all', labelKey: 'all' },
  { id: 'active', labelKey: 'active' },
  { id: 'cron', labelKey: 'cron' },
  { id: 'webhook', labelKey: 'webhook' },
  { id: 'heartbeat', labelKey: 'heartbeat' },
  { id: 'channel', labelKey: 'channel' },
  { id: 'desktop', labelKey: 'desktop' },
];

function createdAtMs(automation: Automation): number {
  const ms = Date.parse(automation.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

export function AutomationList({
  automations,
  loading,
  onSelect,
  onCreate,
  onToggle,
  onTrigger,
  onDelete,
}: AutomationListProps) {
  const { t } = useLanguage();
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialValues, setCreateInitialValues] = useState<
    Partial<CreateAutomationInput> | undefined
  >(undefined);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const openWithTemplate = (preset: Partial<CreateAutomationInput>) => {
    setCreateInitialValues(preset);
    setCreateOpen(true);
  };

  const openBlank = () => {
    setCreateInitialValues(undefined);
    setCreateOpen(true);
  };

  useEffect(() => {
    const handler = () => openBlank();
    window.addEventListener('automation:open-create', handler);
    return () => window.removeEventListener('automation:open-create', handler);
  }, []);

  const sortedAutomations = useMemo(
    () => [...automations].sort((a, b) => createdAtMs(b) - createdAtMs(a)),
    [automations],
  );

  const filtered = useMemo(
    () =>
      sortedAutomations.filter((a) => {
        switch (activeFilter) {
          case 'all':
            return true;
          case 'active':
            return a.enabled;
          case 'channel':
            return a.origin === 'channel';
          case 'desktop':
            return (
              !a.channelDelivery || a.channelDelivery.platform === 'desktop'
            );
          case 'cron':
          case 'webhook':
          case 'heartbeat':
          case 'manual':
            return a.trigger.type === activeFilter;
          default:
            return true;
        }
      }),
    [activeFilter, sortedAutomations],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-foreground text-xl font-semibold">
          {t.automation.title}
        </h2>
        <Button onClick={openBlank} aria-label={t.automation.create}>
          <Plus className="mr-2 size-4" />
          {t.automation.create}
        </Button>
      </div>

      {/* Filter Tabs */}
      {automations.length > 0 && (
        <div className="flex flex-wrap gap-1 rounded-lg border p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                activeFilter === tab.id
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted',
              )}
              aria-label={`Filter: ${t.automation.filter[tab.id as keyof typeof t.automation.filter] ?? tab.id}`}
            >
              {t.automation.filter[
                tab.id as keyof typeof t.automation.filter
              ] ?? tab.id}
            </button>
          ))}
        </div>
      )}

      {/* Template Gallery — shown when empty */}
      {automations.length === 0 && (
        <AutomationTemplateGallery onSelect={openWithTemplate} />
      )}

      {/* Content */}
      {automations.length === 0 ? (
        <AutomationEmptyState onCreate={openBlank} />
      ) : filtered.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          {t.automation.noMatch}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              onClick={() => onSelect(automation)}
              onToggle={(enabled) => onToggle(automation.id, enabled)}
              onTrigger={() => onTrigger(automation.id)}
              onDelete={() => onDelete(automation.id)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <AutomationCreateDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) setCreateInitialValues(undefined);
        }}
        initialValues={createInitialValues}
        onCreate={onCreate}
      />
    </div>
  );
}
