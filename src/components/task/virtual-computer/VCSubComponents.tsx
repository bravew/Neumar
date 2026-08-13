import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Code,
  FileText,
  Maximize2,
  MessageSquare,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { Streamdown } from 'streamdown';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { cn } from '@/shared/lib/utils';

import type { StepOutput } from './vc-utils';

// Window Header Component
export function WindowHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <div className="flex items-center gap-1">
        <button
          aria-label="Messages"
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <MessageSquare className="size-4" />
        </button>
        <button
          aria-label="Maximize"
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <Maximize2 className="size-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-gray-200" />
        <button
          aria-label="Close"
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

// Timeline Control Component
export function TimelineControl({
  currentStep,
  totalSteps,
  isLive,
  liveLabel,
  onPrev,
  onNext,
  onSliderChange,
}: {
  currentStep: number;
  totalSteps: number;
  isLive: boolean;
  liveLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onSliderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="shrink-0 border-b border-gray-100 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Navigation buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onPrev}
            disabled={currentStep === 0 || totalSteps === 0}
            aria-label="Previous step"
            className={cn(
              'flex size-7 items-center justify-center rounded transition-all',
              currentStep === 0 || totalSteps === 0
                ? 'cursor-not-allowed text-gray-300'
                : 'cursor-pointer text-gray-500 hover:bg-gray-100 hover:text-gray-700',
            )}
          >
            <SkipBack className="size-4" />
          </button>
          <button
            onClick={onNext}
            disabled={currentStep === totalSteps - 1 || totalSteps === 0}
            aria-label="Next step"
            className={cn(
              'flex size-7 items-center justify-center rounded transition-all',
              currentStep === totalSteps - 1 || totalSteps === 0
                ? 'cursor-not-allowed text-gray-300'
                : 'cursor-pointer text-gray-500 hover:bg-gray-100 hover:text-gray-700',
            )}
          >
            <SkipForward className="size-4" />
          </button>
        </div>

        {/* Live indicator dot */}
        <div
          className={cn(
            'size-2.5 rounded-full transition-colors',
            isLive ? 'bg-blue-500' : 'bg-gray-300',
          )}
        />

        {/* Progress slider */}
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(0, totalSteps - 1)}
            value={currentStep}
            onChange={onSliderChange}
            disabled={totalSteps === 0}
            aria-label={liveLabel}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
          />
        </div>

        {/* Live label */}
        <div className="flex min-w-[50px] items-center justify-end gap-1.5">
          <div
            className={cn(
              'size-2 rounded-full',
              isLive ? 'bg-emerald-500' : 'bg-gray-300',
            )}
          />
          <span
            className={cn(
              'text-sm',
              isLive ? 'font-medium text-gray-700' : 'text-gray-400',
            )}
          >
            {liveLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

// Task Progress Component
export function TaskProgress({
  steps,
  currentStep,
  isRunning,
  isExpanded,
  defaultDescription,
  onToggle,
}: {
  steps: StepOutput[];
  currentStep: number;
  isRunning: boolean;
  isExpanded: boolean;
  defaultDescription: string;
  onToggle: () => void;
}) {
  const allCompleted = !isRunning && steps.length > 0;
  const completedSteps = allCompleted ? steps.length : currentStep + 1;
  const totalSteps = Math.max(steps.length, 1);

  const currentDescription =
    steps[currentStep]?.description || defaultDescription;

  return (
    <div className="shrink-0 bg-white">
      {/* Collapsed header - always visible */}
      <button
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
      >
        {/* Status icon */}
        {allCompleted ? (
          <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
        ) : isRunning ? (
          <AILoadingIndicator size="sm" />
        ) : (
          <Circle className="size-5 shrink-0 text-gray-300" />
        )}

        {/* Current step description */}
        <span className="flex-1 truncate text-left text-sm text-gray-700">
          {currentDescription}
        </span>

        {/* Step count and expand icon */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400 tabular-nums">
            {completedSteps} / {totalSteps}
          </span>
          {isExpanded ? (
            <ChevronDown className="size-4 text-gray-400" />
          ) : (
            <ChevronUp className="size-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded step list */}
      {isExpanded && steps.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto border-t border-gray-100 px-4 py-2">
          <div className="space-y-1">
            {steps.map((step, index) => {
              const isCompleted = allCompleted || index < currentStep;
              const isCurrent = index === currentStep;

              return (
                <div
                  key={index}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                    isCurrent && !allCompleted && 'bg-blue-50',
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : isCurrent && isRunning ? (
                    <AILoadingIndicator size="sm" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-gray-300" />
                  )}
                  <span
                    className={cn(
                      'truncate text-sm',
                      isCompleted || isCurrent
                        ? 'text-gray-700'
                        : 'text-gray-400',
                    )}
                  >
                    {step.description}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Terminal Content renderer
export function TerminalContent({
  content,
}: {
  content: NonNullable<StepOutput['content']>;
}) {
  switch (content.type) {
    case 'terminal':
      return (
        <div className="p-4 font-mono text-sm">
          {content.value.split('\n').map((line, i) => {
            if (line.startsWith('$')) {
              return (
                <div key={i} className="flex">
                  <span className="text-emerald-600">ubuntu@sandbox:~ </span>
                  <span className="text-emerald-600">{line}</span>
                </div>
              );
            }
            return (
              <div key={i} className="text-gray-700">
                {line}
              </div>
            );
          })}
          <div className="mt-1 flex">
            <span className="text-emerald-600">ubuntu@sandbox:~ $</span>
          </div>
        </div>
      );

    case 'markdown':
      return (
        <article className="prose prose-sm prose-headings:text-gray-800 prose-p:text-gray-600 prose-strong:text-gray-800 prose-code:text-blue-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded max-w-none p-4">
          <Streamdown mode="static" plugins={{ code, cjk }}>
            {content.value}
          </Streamdown>
        </article>
      );

    case 'code':
      return (
        <div className="flex h-full flex-col">
          {content.filename && (
            <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
              <FileText className="size-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">
                {content.filename}
              </span>
              {content.language && (
                <span className="ml-auto rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
                  {content.language}
                </span>
              )}
            </div>
          )}
          <div className="flex-1 overflow-auto p-4">
            <pre className="font-mono text-sm">
              <code className="text-gray-700">{content.value}</code>
            </pre>
          </div>
        </div>
      );

    case 'json':
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
            <Code className="size-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">JSON</span>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <pre className="font-mono text-sm">
              <code className="text-amber-600">{content.value}</code>
            </pre>
          </div>
        </div>
      );

    case 'text':
    default:
      return (
        <div className="p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-600">
            {content.value}
          </p>
        </div>
      );
  }
}
