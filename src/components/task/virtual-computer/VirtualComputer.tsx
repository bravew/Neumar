import { useEffect, useMemo, useRef, useState } from 'react';

import { Monitor, Play, Terminal } from 'lucide-react';

import { APP_NAME } from '@/config';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  extractStepOutputs,
  getToolActionText,
  getToolIcon,
  getToolTypeLabel,
} from './vc-utils';
import {
  TaskProgress,
  TerminalContent,
  TimelineControl,
  WindowHeader,
} from './VCSubComponents';

export interface VirtualComputerProps {
  messages: AgentMessage[];
  isRunning: boolean;
  selectedStepIndex?: number | null;
  onStepSelect?: (index: number) => void;
}

export function VirtualComputer({
  messages,
  isRunning,
  selectedStepIndex,
  onStepSelect,
}: VirtualComputerProps) {
  const { t } = useLanguage();
  const tt = t.task;
  const steps = useMemo(() => extractStepOutputs(messages, tt), [messages, tt]);
  const [internalStep, setInternalStep] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [isProgressExpanded, setIsProgressExpanded] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Use external selection if provided, otherwise use internal state
  const currentStep =
    selectedStepIndex !== null && selectedStepIndex !== undefined
      ? selectedStepIndex
      : internalStep;

  const setCurrentStep = (step: number) => {
    if (onStepSelect) {
      onStepSelect(step);
    } else {
      setInternalStep(step);
    }
  };

  // Auto-advance to latest step when running and live mode is on
  useEffect(() => {
    if (steps.length > 0 && isLive && selectedStepIndex == null) {
      setInternalStep(steps.length - 1);
    }
  }, [steps.length, isLive, selectedStepIndex]);

  // Scroll terminal to bottom when content updates in live mode
  useEffect(() => {
    if (isLive && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [steps, currentStep, isLive]);

  const currentStepData = steps[currentStep];
  const IconComponent = currentStepData
    ? getToolIcon(currentStepData.toolIcon)
    : Terminal;

  const handlePrevStep = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
    setIsLive(false);
  };

  const handleNextStep = () => {
    if (currentStep === steps.length - 1) {
      setIsLive(true);
    } else {
      setCurrentStep(Math.min(steps.length - 1, currentStep + 1));
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value, 10);
    setCurrentStep(newValue);
    setIsLive(newValue === steps.length - 1);
  };

  const jumpToLive = () => {
    setIsLive(true);
    if (steps.length > 0) {
      setCurrentStep(steps.length - 1);
    }
  };

  // Empty state
  if (steps.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <WindowHeader title={tt.vcTitle.replace('{app}', APP_NAME)} />

        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-4 py-2">
          <Terminal className="size-4 text-gray-400" />
          <span className="text-sm text-gray-500">
            {tt.vcAgentUsing}{' '}
            <span className="font-medium text-gray-700">
              {tt.vcToolTerminal}
            </span>
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 p-8">
          <div className="flex flex-col items-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-xl border border-gray-200 bg-white">
              <Monitor className="size-8 text-gray-300" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">
              {isRunning ? tt.vcAgentStarting : tt.vcReadyToWork}
            </h3>
            <p className="mt-1 text-xs text-gray-400">
              {tt.vcToolOutputsAppear}
            </p>
            {isRunning && (
              <div className="mt-4 flex items-center gap-1">
                <div className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                <div className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                <div className="size-1.5 animate-bounce rounded-full bg-emerald-500" />
              </div>
            )}
          </div>
        </div>

        <TimelineControl
          currentStep={0}
          totalSteps={0}
          isLive={true}
          liveLabel={tt.vcLive}
          onPrev={() => {}}
          onNext={() => {}}
          onSliderChange={() => {}}
        />

        <TaskProgress
          steps={[]}
          currentStep={0}
          isRunning={isRunning}
          isExpanded={false}
          defaultDescription={tt.vcPreparing}
          onToggle={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <WindowHeader title={tt.vcTitle.replace('{app}', APP_NAME)} />

      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-4 py-2">
        <IconComponent className="size-4 text-gray-400" />
        <span className="text-sm text-gray-500">
          {tt.vcAgentUsing}{' '}
          <span className="font-medium text-gray-700">
            {getToolTypeLabel(currentStepData?.toolName || '', tt)}
          </span>
        </span>
        <span className="text-gray-300">|</span>
        <span className="flex-1 truncate text-sm text-gray-500">
          {getToolActionText(
            currentStepData?.toolName || '',
            tt,
            currentStepData?.input,
          )}
        </span>
      </div>

      {/* Terminal Container */}
      <div className="flex flex-1 flex-col overflow-hidden border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-center border-b border-gray-200 bg-white py-2">
          <span className="text-xs font-medium text-gray-500">
            {currentStepData?.description || tt.vcStepOutput}
          </span>
        </div>

        <div ref={terminalRef} className="flex-1 overflow-auto bg-white">
          {currentStepData?.content ? (
            <TerminalContent content={currentStepData.content} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-4">
              <p className="text-sm text-gray-400 italic">
                {currentStepData?.description}
              </p>
            </div>
          )}
        </div>

        {!isLive && (
          <div className="flex justify-center border-t border-gray-100 bg-white py-3">
            <button
              onClick={jumpToLive}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50"
            >
              <Play className="size-3.5" />
              {tt.vcJumpToLive}
            </button>
          </div>
        )}
      </div>

      <TimelineControl
        currentStep={currentStep}
        totalSteps={steps.length}
        isLive={isLive}
        liveLabel={tt.vcLive}
        onPrev={handlePrevStep}
        onNext={handleNextStep}
        onSliderChange={handleSliderChange}
      />

      <TaskProgress
        steps={steps}
        currentStep={currentStep}
        isRunning={isRunning}
        isExpanded={isProgressExpanded}
        defaultDescription={tt.vcPreparing}
        onToggle={() => setIsProgressExpanded(!isProgressExpanded)}
      />
    </div>
  );
}
