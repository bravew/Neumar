import { ChevronLeft, ChevronRight } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLanguage } from '@/shared/providers/language-provider';

interface BranchNavigatorProps {
  /** Total number of branches at this fork point (including main) */
  totalBranches: number;
  /** 1-based index of the currently selected branch */
  currentIndex: number;
  onPrevious: () => void;
  onNext: () => void;
}

export function BranchNavigator({
  totalBranches,
  currentIndex,
  onPrevious,
  onNext,
}: BranchNavigatorProps) {
  const { t } = useLanguage();

  if (totalBranches <= 1) return null;

  const label = t.task.branchNavLabel
    .replace('{current}', String(currentIndex))
    .replace('{total}', String(totalBranches));

  return (
    <TooltipProvider delayDuration={0}>
      <div className="mb-2 flex items-center justify-center gap-1">
        <div className="text-muted-foreground bg-muted/50 inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-xs">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onPrevious}
                disabled={currentIndex <= 1}
                className="hover:text-foreground cursor-pointer rounded-full p-0.5 transition-colors disabled:cursor-default disabled:opacity-30"
                aria-label={t.task.branchNavPrevious}
              >
                <ChevronLeft className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t.task.branchNavPrevious}
            </TooltipContent>
          </Tooltip>

          <span className="min-w-[3ch] px-1 text-center font-mono">
            {label}
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onNext}
                disabled={currentIndex >= totalBranches}
                className="hover:text-foreground cursor-pointer rounded-full p-0.5 transition-colors disabled:cursor-default disabled:opacity-30"
                aria-label={t.task.branchNavNext}
              >
                <ChevronRight className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t.task.branchNavNext}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
