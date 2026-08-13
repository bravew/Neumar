import type { ReactNode } from 'react';

import {
  Calculator,
  FileText,
  PanelsTopLeft,
  PlayCircle,
  WandSparkles,
} from 'lucide-react';

import { useSidebar } from '@/components/layout/sidebar-context';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { VideoEditorStep } from './editorTypes';
import { VIDEO_EDITOR_STEPS } from './editorTypes';

interface ProjectStepperProps {
  value: VideoEditorStep;
  derived: VideoEditorStep;
  onChange: (step: VideoEditorStep) => void;
  /** Optional content rendered before the step tabs (e.g. project title). */
  leading?: ReactNode;
  /** Optional content rendered after the step tabs (e.g. tool toggles). */
  trailing?: ReactNode;
}

const STEP_ICONS = {
  brief: FileText,
  board: PanelsTopLeft,
  plan: Calculator,
  generate: WandSparkles,
  preview: PlayCircle,
} satisfies Record<VideoEditorStep, typeof FileText>;

export function ProjectStepper({
  value,
  derived,
  onChange,
  leading,
  trailing,
}: ProjectStepperProps) {
  const { t } = useLanguage();
  const { leftOpen } = useSidebar();

  return (
    <nav
      className={cn(
        'border-border bg-muted/20 flex items-center gap-2 border-b px-3 py-1.5',
        // When the sidebar is collapsed, the floating expand button occupies
        // the top-left corner — reserve room so it doesn't cover the back
        // button. Only the header row indents; the panels below stay flush.
        !leftOpen && 'pl-12',
      )}
      aria-label={t.video.editor.stepperLabel}
    >
      {leading ? (
        <div className="flex min-w-0 shrink items-center gap-2">{leading}</div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {VIDEO_EDITOR_STEPS.map((step, index) => {
          const active = value === step;
          const Icon = STEP_ICONS[step];

          return (
            <button
              key={step}
              type="button"
              aria-pressed={active}
              aria-current={derived === step ? 'step' : undefined}
              className={
                active
                  ? 'bg-background text-foreground flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-sm'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs'
              }
              onClick={() => onChange(step)}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{t.video.editor.step[step]}</span>
              <span className="text-muted-foreground hidden text-[11px] xl:inline">
                {index + 1}
              </span>
            </button>
          );
        })}
      </div>
      {trailing ? (
        <div className="ml-2 flex shrink-0 items-center gap-1">{trailing}</div>
      ) : null}
    </nav>
  );
}
