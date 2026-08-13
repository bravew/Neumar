/**
 * AutomationDetail
 *
 * Automation detail view showing configuration summary and run history.
 */

import { useState } from 'react';

import { ArrowLeft, Edit, Play, Power, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  Automation,
  AutomationRun,
  UpdateAutomationInput,
} from '@/shared/types/automation';

import { AutomationCreateDialog } from './AutomationCreateDialog';
import { AutomationMetadata } from './AutomationMetadata';
import { AutomationRunDetail } from './AutomationRunDetail';
import { AutomationRunHistory } from './AutomationRunHistory';
import { getTriggerIcon } from './utils';

interface AutomationDetailProps {
  automation: Automation;
  onBack: () => void;
  onToggle: (enabled: boolean) => void;
  onTrigger: () => void;
  onUpdate: (id: string, input: UpdateAutomationInput) => Promise<void>;
  onDelete: () => void;
  onCancelRun: (runId: string) => void;
}

export function AutomationDetail({
  automation,
  onBack,
  onToggle,
  onTrigger,
  onUpdate,
  onDelete,
  onCancelRun,
}: AutomationDetailProps) {
  const { t } = useLanguage();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null);

  const TriggerIcon = getTriggerIcon(automation.trigger.type);

  // If a run is selected, show run detail
  if (selectedRun) {
    return (
      <AutomationRunDetail
        run={selectedRun}
        onBack={() => setSelectedRun(null)}
        onCancel={onCancelRun}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label={t.common.back}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex size-10 items-center justify-center rounded-lg',
                automation.enabled
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <TriggerIcon className="size-5" />
            </div>
            <div>
              <h2 className="text-foreground text-lg font-semibold">
                {automation.name}
              </h2>
              {automation.description && (
                <p className="text-muted-foreground text-sm">
                  {automation.description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onTrigger}
            aria-label={t.automation.runNow}
          >
            <Play className="mr-1.5 size-3.5" />
            {t.automation.runNow}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditOpen(true)}
            aria-label={t.automation.edit}
          >
            <Edit className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggle(!automation.enabled)}
            aria-label={
              automation.enabled ? t.automation.disable : t.automation.enable
            }
          >
            <Power
              className={cn(
                'size-4',
                automation.enabled ? 'text-green-500' : 'text-gray-400',
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="text-red-500 hover:text-red-600"
            aria-label={t.automation.delete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Config Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.detail.trigger}
          </p>
          <p className="text-foreground text-sm">
            {t.automation.trigger[automation.trigger.type]}
            {automation.trigger.type === 'heartbeat' &&
              automation.trigger.heartbeat.mode === 'queue_pickup' &&
              ` (${t.automation.queuePickup.queuePickup})`}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.detail.planning}
          </p>
          <p className="text-foreground text-sm">
            {automation.agent.usePlanning
              ? automation.agent.autoApprove
                ? t.automation.detail.planAutoApprove
                : t.automation.detail.planManualApprove
              : t.automation.detail.directExecution}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            {t.automation.run.status}
          </p>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'size-2 rounded-full',
                automation.enabled ? 'bg-green-500' : 'bg-gray-400',
              )}
            />
            <span className="text-foreground text-sm">
              {automation.enabled ? t.automation.active : t.automation.inactive}
            </span>
          </div>
        </div>
      </div>

      {/* Origin, Delivery & Metadata */}
      <AutomationMetadata automation={automation} />

      {/* Prompt Preview */}
      <div className="rounded-lg border p-4">
        <h4 className="text-foreground mb-2 text-sm font-semibold">
          {t.automation.fields.prompt}
        </h4>
        <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-wrap">
          {automation.prompt}
        </p>
      </div>

      {/* Run History */}
      <div>
        <h4 className="text-foreground mb-3 text-sm font-semibold">
          {t.automation.run.runHistory}
        </h4>
        <AutomationRunHistory
          automationId={automation.id}
          onSelectRun={setSelectedRun}
        />
      </div>

      {/* Edit Dialog */}
      <AutomationCreateDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        automation={automation}
        onUpdate={onUpdate}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          onDelete();
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}

// ============================================================================
// Delete Confirmation Dialog (extracted for component size)
// ============================================================================

function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.automation.deleteConfirm}</DialogTitle>
          <DialogDescription>
            {t.automation.deleteDescription}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label={t.common.cancel}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            aria-label={t.automation.delete}
          >
            {t.automation.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
