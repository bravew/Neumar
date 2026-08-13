import { useState } from 'react';

import { useNavigate } from 'react-router-dom';

import {
  ArrowLeft,
  Bot,
  Bug,
  FileCheck2,
  MoreHorizontal,
  Pencil,
  Settings,
  SquareArrowOutUpRight,
  Terminal,
} from 'lucide-react';

import ImageLogo from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { APP_NAME } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignBudgetStatus,
  DesignMdState,
  DesignProject,
} from '@/shared/types/design-mode';

import { localizedIntentLabel, surfaceLabel } from './constants';
import { DesignHandoffMenu } from './DesignHandoffMenu';
import { ProjectDesignSystemSwitcher } from './ProjectDesignSystemSwitcher';
import { ProjectInstructionsDialog } from './ProjectInstructionsDialog';

export function ProjectHeader({
  project,
  title,
  budget,
  debugLoading,
  juryEnabled,
  juryLoading,
  designMdState,
  finalizing,
  continueCopied,
  onBack,
  onTitleChange,
  onTitleBlur,
  onResolvePrompt,
  onOpenDebug,
  onRunJury,
  onFinalizeDesign,
  onContinueInCli,
  onOpenSettings,
  onProjectChange,
  onCustomInstructionsSave,
  designSystemInComposer = false,
}: {
  project: DesignProject;
  title: string;
  budget: DesignBudgetStatus | null;
  debugLoading: boolean;
  juryEnabled: boolean;
  juryLoading: boolean;
  designMdState: DesignMdState;
  finalizing: boolean;
  continueCopied: boolean;
  onBack: () => void;
  onTitleChange: (value: string) => void;
  onTitleBlur: () => void | Promise<void>;
  onResolvePrompt: () => void | Promise<void>;
  onOpenDebug: () => void | Promise<void>;
  onRunJury: () => void;
  onFinalizeDesign: () => void;
  onContinueInCli: () => void;
  onOpenSettings: () => void;
  onProjectChange?: (project: DesignProject) => void;
  onCustomInstructionsSave: (value: string) => void | Promise<void>;
  /** When the composer hosts the design-system pill (chat loop), hide it here
   *  so the control isn't duplicated. */
  designSystemInComposer?: boolean;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [instructionsSaving, setInstructionsSaving] = useState(false);
  const canHandoff = project.outputs.length > 0 || designMdState.exists;
  const saveInstructions = async (value: string) => {
    setInstructionsSaving(true);
    try {
      await onCustomInstructionsSave(value);
      setInstructionsOpen(false);
    } finally {
      setInstructionsSaving(false);
    }
  };
  return (
    <header className="border-border flex min-w-0 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5">
      <button
        type="button"
        onClick={() => navigate('/')}
        aria-label={t.design.regularMode}
        className="text-muted-foreground hover:bg-accent hover:text-foreground -ml-1 flex max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
      >
        <ArrowLeft className="size-4" />
        <img
          src={ImageLogo}
          alt={APP_NAME}
          className="size-5 shrink-0 object-contain"
        />
        <span className="text-foreground truncate text-sm font-semibold">
          {APP_NAME}
        </span>
        <span className="text-muted-foreground text-sm">/</span>
        <span className="text-foreground truncate text-sm font-medium">
          {t.modes.design.label}
        </span>
      </button>
      <span className="bg-border h-5 w-px shrink-0" aria-hidden />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t.design.backToDesigns}
        onClick={onBack}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <input
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        onBlur={onTitleBlur}
        aria-label={t.design.projectName}
        title={title}
        className="max-w-[min(42rem,100%)] min-w-0 flex-1 truncate bg-transparent text-lg font-semibold outline-none"
      />
      <span className="bg-muted max-w-40 truncate rounded px-2 py-1 text-xs">
        {surfaceLabel(project.surface)}
      </span>
      {project.intent && (
        <span className="bg-muted max-w-40 truncate rounded px-2 py-1 text-xs">
          {localizedIntentLabel(project.intent, t.design.intents)}
        </span>
      )}
      {designSystemInComposer ? null : onProjectChange ? (
        <ProjectDesignSystemSwitcher
          project={project}
          onProjectChange={onProjectChange}
        />
      ) : project.designSystemId ? (
        <span className="bg-muted max-w-48 truncate rounded px-2 py-1 text-xs">
          {project.designSystemId}
        </span>
      ) : null}
      {project.customInstructions?.trim() && (
        <span className="bg-primary/10 text-primary rounded px-2 py-1 text-xs">
          {t.design.customInstructionsChip}
        </span>
      )}
      {budget && <BudgetChip budget={budget} />}
      {designMdState.exists && designMdState.isStale && (
        <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
          {designMdState.staleReason === 'unknown-provenance'
            ? t.design.designMdFreshnessUnknown
            : t.design.designMdStale}
        </span>
      )}
      {/* Secondary project actions collapsed into one overflow menu so the
          header stays uncluttered (Studio-parity, Fix-sync Phase 01). */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.design.moreActions}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => setInstructionsOpen(true)}>
              <Pencil className="size-4" />
              {t.design.customInstructionsShort}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void onResolvePrompt()}>
              <Settings className="size-4" />
              {t.design.resolvedPrompt}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={debugLoading}
              onSelect={() => void onOpenDebug()}
            >
              <Bug className="size-4" />
              {debugLoading ? t.design.loadingDebug : t.design.projectDebug}
            </DropdownMenuItem>
            {juryEnabled && (
              <DropdownMenuItem disabled={juryLoading} onSelect={onRunJury}>
                <Bot className="size-4" />
                {juryLoading ? t.design.runningDesignJury : t.design.designJury}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={finalizing} onSelect={onFinalizeDesign}>
              <FileCheck2 className="size-4" />
              {finalizing
                ? t.design.finalizingDesign
                : !designMdState.exists
                  ? t.design.finalizeDesignPackage
                  : designMdState.isStale
                    ? t.design.refinalizeDesignStale
                    : t.design.refinalizeDesign}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!designMdState.exists}
              onSelect={onContinueInCli}
            >
              <Terminal className="size-4" />
              {continueCopied
                ? t.design.continueInCliCopied
                : t.design.continueInCli}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {canHandoff && (
          <DesignHandoffMenu projectId={project.id}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.design.openWithEditor}
              data-testid="design-handoff-trigger"
            >
              <SquareArrowOutUpRight className="size-4" />
            </Button>
          </DesignHandoffMenu>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.settings.designMode}
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
        </Button>
      </div>
      <ProjectInstructionsDialog
        open={instructionsOpen}
        value={project.customInstructions ?? ''}
        saving={instructionsSaving}
        onOpenChange={setInstructionsOpen}
        onSave={(value) => void saveInstructions(value)}
      />
    </header>
  );
}

function BudgetChip({ budget }: { budget: DesignBudgetStatus }) {
  const { t } = useLanguage();
  const tone =
    budget.severity === 'urgent' || budget.severity === 'blocked'
      ? 'bg-destructive/10 text-destructive'
      : budget.severity === 'soft'
        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('rounded px-2 py-1 text-xs', tone)}>
      {t.design.budget} {budget.remaining.imageGenerations}{' '}
      {t.design.imageShort} · {budget.remaining.videoJobs} {t.design.videoShort}{' '}
      · {budget.remaining.audioSeconds}s {t.design.audioShort}
    </span>
  );
}
