/**
 * AutomationCreateDialog
 *
 * Create/edit automation dialog with sections for basic info,
 * prompt, trigger, agent settings, and delivery.
 */

import { useEffect, useState } from 'react';

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
  AutomationAgentConfig as AgentConfigType,
  Automation,
  AutomationChannelDelivery,
  AutomationDelivery,
  AutomationTrigger,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '@/shared/types/automation';

import { AutomationAgentConfig } from './AutomationAgentConfig';
import { AutomationDeliveryConfig } from './AutomationDeliveryConfig';
import { AutomationTriggerConfig } from './AutomationTriggerConfig';

interface AutomationCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, dialog operates in edit mode */
  automation?: Automation;
  /** Pre-fill form values from a template */
  initialValues?: Partial<CreateAutomationInput>;
  onCreate?: (input: CreateAutomationInput) => Promise<void>;
  onUpdate?: (id: string, input: UpdateAutomationInput) => Promise<void>;
}

export function AutomationCreateDialog({
  open,
  onOpenChange,
  automation,
  initialValues,
  onCreate,
  onUpdate,
}: AutomationCreateDialogProps) {
  const { t } = useLanguage();
  const isEdit = !!automation;

  // Form state
  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const [prompt, setPrompt] = useState(automation?.prompt ?? '');
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    automation?.trigger ?? { type: 'manual' },
  );
  const [agent, setAgent] = useState<AgentConfigType>(
    automation?.agent ?? {
      usePlanning: false,
      autoApprove: true,
    },
  );
  const [delivery, setDelivery] = useState<AutomationDelivery>(
    automation?.delivery ?? { mode: 'none' },
  );
  const [channelDelivery, setChannelDelivery] = useState<
    AutomationChannelDelivery | undefined
  >(automation?.channelDelivery);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset form state when the dialog opens or automation prop changes
  useEffect(() => {
    if (open) {
      setName(automation?.name ?? initialValues?.name ?? '');
      setDescription(
        automation?.description ?? initialValues?.description ?? '',
      );
      setPrompt(automation?.prompt ?? initialValues?.prompt ?? '');
      setTrigger(
        automation?.trigger ?? initialValues?.trigger ?? { type: 'manual' },
      );
      setAgent(
        automation?.agent ??
          initialValues?.agent ?? { usePlanning: false, autoApprove: true },
      );
      setDelivery(
        automation?.delivery ?? initialValues?.delivery ?? { mode: 'none' },
      );
      setChannelDelivery(
        automation?.channelDelivery ?? initialValues?.channelDelivery,
      );
      setFormError(null);
    }
  }, [open, automation, initialValues]);

  const handleSubmit = async () => {
    // Validate required fields
    if (!name.trim()) {
      setFormError(t.automation.validation.nameRequired);
      return;
    }
    if (!prompt.trim()) {
      setFormError(t.automation.validation.promptRequired);
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (isEdit && onUpdate && automation) {
        await onUpdate(automation.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          trigger,
          agent,
          delivery,
          channelDelivery:
            delivery.mode === 'channel' ? channelDelivery : undefined,
        });
      } else if (onCreate) {
        await onCreate({
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          trigger,
          agent,
          delivery,
          channelDelivery:
            delivery.mode === 'channel' ? channelDelivery : undefined,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : t.automation.errors.generic,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t.automation.edit : t.automation.create}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? t.automation.dialog.editDescription
              : t.automation.dialog.createDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <section className="space-y-3">
            <h4 className="text-foreground text-sm font-semibold">
              {t.automation.fields.basicInfo}
            </h4>
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                {t.automation.fields.name}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Automation"
                className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
                aria-label={t.automation.fields.name}
              />
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                {t.automation.fields.description}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
                aria-label={t.automation.fields.description}
              />
            </div>
          </section>

          {/* Prompt */}
          <section className="space-y-3">
            <h4 className="text-foreground text-sm font-semibold">
              {t.automation.fields.prompt}
            </h4>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the task for the agent..."
              rows={4}
              className="bg-background text-foreground border-input w-full rounded-md border px-3 py-2 text-sm"
              aria-label={t.automation.fields.prompt}
            />
          </section>

          {/* Trigger */}
          <section className="space-y-3">
            <h4 className="text-foreground text-sm font-semibold">
              {t.automation.fields.triggerType}
            </h4>
            <AutomationTriggerConfig
              trigger={trigger}
              onChange={setTrigger}
              isEdit={isEdit}
            />
          </section>

          {/* Agent Settings */}
          <section className="space-y-3">
            <h4 className="text-foreground text-sm font-semibold">
              {t.automation.fields.agentSettings}
            </h4>
            <AutomationAgentConfig config={agent} onChange={setAgent} />
          </section>

          {/* Delivery */}
          <section className="space-y-3">
            <h4 className="text-foreground text-sm font-semibold">
              {t.automation.fields.delivery}
            </h4>
            <AutomationDeliveryConfig
              delivery={delivery}
              onChange={setDelivery}
              channelDelivery={channelDelivery}
              onChannelDeliveryChange={setChannelDelivery}
            />
          </section>

          {/* Error */}
          {formError && (
            <p className={cn('text-sm text-red-500')} role="alert">
              {formError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label={t.common.cancel}
          >
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            aria-label={isEdit ? t.common.save : t.automation.create}
          >
            {submitting
              ? t.common.loading
              : isEdit
                ? t.common.save
                : t.automation.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
