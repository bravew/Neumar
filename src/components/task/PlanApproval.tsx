import { Ban, Check, ListTodo, Play, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import {
  DURATION,
  EASE,
  PulsingDot,
  SPRING,
  STAGGER,
} from '@/config/animation';
import { getSettings, saveSettings } from '@/shared/db/settings';
import type { TaskPlan } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface PlanApprovalProps {
  plan: TaskPlan;
  isWaitingApproval: boolean;
  autoExecute?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

export function PlanApproval({
  plan,
  isWaitingApproval,
  autoExecute,
  onApprove,
  onReject,
}: PlanApprovalProps) {
  const { t } = useLanguage();

  // Check if all steps are completed
  const isAllCompleted = plan.steps.every(
    (step) => step.status === 'completed',
  );

  // Check if plan was cancelled
  const isCancelled = plan.steps.some((step) => step.status === 'cancelled');

  // Compute completed/total for stopped-with-progress badge
  const completedCount = plan.steps.filter(
    (step) => step.status === 'completed',
  ).length;
  const totalCount = plan.steps.length;
  const isStoppedWithProgress = isCancelled && completedCount > 0;

  return (
    <motion.div
      className={cn(
        'space-y-4 rounded-xl border p-4',
        isStoppedWithProgress && !isWaitingApproval
          ? 'border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/20'
          : isCancelled && !isWaitingApproval
            ? 'border-muted-foreground/30 bg-muted/30'
            : isAllCompleted && !isWaitingApproval
              ? 'border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20'
              : 'border-primary/30 bg-accent/30',
      )}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING.gentle }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-foreground flex items-center gap-2 text-sm font-medium">
          {isStoppedWithProgress && !isWaitingApproval ? (
            <Ban className="size-4 text-amber-500" />
          ) : isCancelled && !isWaitingApproval ? (
            <Ban className="text-muted-foreground size-4" />
          ) : isAllCompleted && !isWaitingApproval ? (
            <Check className="size-4 text-emerald-500" />
          ) : (
            <ListTodo className="text-primary size-4" />
          )}
          {t.task.executionPlan}
          {isWaitingApproval ? (
            <span className="bg-primary/20 text-primary rounded-full px-2 py-0.5 text-xs">
              {t.task.pendingApproval}
            </span>
          ) : isStoppedWithProgress ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {t.task.planStopped
                .replace('{completed}', String(completedCount))
                .replace('{total}', String(totalCount))}
            </span>
          ) : isCancelled ? (
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
              {t.task.planCancelled}
            </span>
          ) : isAllCompleted ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              {t.task.planCompleted}
            </span>
          ) : null}
        </div>
      </div>

      {/* Goal */}
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">{t.task.goal}</p>
        <p className="text-foreground text-sm">{plan.goal}</p>
      </div>

      {/* Steps */}
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">
          {t.task.stepsCount.replace('{count}', String(plan.steps.length))}
        </p>
        <div className="space-y-2">
          {plan.steps.map((step, index) => (
            <motion.div
              key={step.id}
              className="flex items-start gap-2.5"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: DURATION.normal,
                ease: EASE.out,
                delay: index * STAGGER.normal,
              }}
            >
              {/* Step number or animated status indicator */}
              <motion.div
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs font-medium transition-colors',
                  step.status === 'completed'
                    ? 'bg-primary border-primary text-primary-foreground'
                    : step.status === 'in_progress'
                      ? 'border-primary bg-primary/10 text-primary'
                      : step.status === 'failed'
                        ? 'border-destructive bg-destructive/10 text-destructive'
                        : step.status === 'cancelled'
                          ? 'border-muted-foreground/30 bg-muted text-muted-foreground'
                          : 'border-muted-foreground/30 bg-background text-muted-foreground',
                )}
                animate={
                  step.status === 'completed'
                    ? { scale: [1, 1.15, 1] }
                    : { scale: 1 }
                }
                transition={{ duration: DURATION.normal, ease: EASE.bounce }}
              >
                {step.status === 'completed' ? (
                  <Check className="size-3" />
                ) : step.status === 'in_progress' ? (
                  <PulsingDot color="bg-primary" size="size-1.5" />
                ) : step.status === 'cancelled' ? (
                  <X className="size-3" />
                ) : (
                  index + 1
                )}
              </motion.div>
              <span
                className={cn(
                  'min-w-0 flex-1 text-sm leading-snug',
                  step.status === 'completed'
                    ? 'text-muted-foreground'
                    : step.status === 'in_progress'
                      ? 'text-foreground font-medium'
                      : step.status === 'failed'
                        ? 'text-destructive'
                        : step.status === 'cancelled'
                          ? 'text-muted-foreground line-through'
                          : 'text-foreground',
                )}
              >
                {step.description}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Notes */}
      {plan.notes && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{t.task.notes}</p>
          <p className="text-muted-foreground text-sm">{plan.notes}</p>
        </div>
      )}

      {/* Action buttons — animated entrance when waiting for approval */}
      <AnimatePresence>
        {isWaitingApproval &&
          (autoExecute ? (
            <motion.div
              className="flex items-center justify-end gap-2 pt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION.normal }}
            >
              <span className="text-primary flex items-center gap-1.5 text-sm">
                <PulsingDot color="bg-primary" size="size-2" />
                {t.task.autoStarting}
              </span>
            </motion.div>
          ) : (
            onApprove &&
            onReject && (
              <motion.div
                className="flex flex-col gap-3 pt-2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.moderate, ease: EASE.out }}
              >
                {/* Action buttons — with tap feedback */}
                <div className="flex items-center justify-end gap-2">
                  <motion.button
                    onClick={onReject}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors"
                    whileTap={{ scale: 0.97 }}
                  >
                    <X className="size-4" />
                    {t.task.cancel}
                  </motion.button>
                  <motion.button
                    onClick={onApprove}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm transition-colors"
                    whileTap={{ scale: 0.97 }}
                    animate={{ scale: [1, 1.02, 1] }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  >
                    <Play className="size-4" />
                    {t.task.startExecution}
                  </motion.button>
                </div>

                {/* Inline auto-execute checkbox — separate row for small screens */}
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5 shrink-0 cursor-pointer rounded"
                    onChange={(e) => {
                      if (e.target.checked) {
                        const settings = getSettings();
                        saveSettings({ ...settings, planMode: 'auto' });
                        onApprove();
                      }
                    }}
                  />
                  <span className="text-muted-foreground text-xs">
                    {t.task.alwaysAutoExecute}
                    <span className="text-muted-foreground/60 ml-1">
                      ({t.task.changeInSettings})
                    </span>
                  </span>
                </label>
              </motion.div>
            )
          ))}
      </AnimatePresence>
    </motion.div>
  );
}
