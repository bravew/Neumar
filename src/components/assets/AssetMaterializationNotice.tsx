import {
  assetMaterializationBudgetLabel,
  type AssetMaterializationBudgetError,
  type AssetMaterializationBudgetLabels,
  type AssetMaterializationState,
} from '@/shared/assets';

export interface AssetMaterializationNoticeLabels extends AssetMaterializationBudgetLabels {
  materializePreparing: string;
  materializeFailed: string;
  materializeComplete: string;
  materializeDerivativeFailed: string;
  materializeDerivativeReady: string;
  materializeProgress: string;
  budgetIncreaseAction: string;
  budgetIncreaseRetrying: string;
  error: string;
}

interface AssetMaterializationNoticeProps {
  attaching: boolean;
  attachError: string | null;
  budgetIncreasing: boolean;
  budgetIssue: AssetMaterializationBudgetError | null;
  className?: string;
  labels: AssetMaterializationNoticeLabels;
  onBudgetRetry: () => void;
  state: AssetMaterializationState | null;
}

export function AssetMaterializationNotice({
  attaching,
  attachError,
  budgetIncreasing,
  budgetIssue,
  className,
  labels,
  onBudgetRetry,
  state,
}: AssetMaterializationNoticeProps) {
  if (!attaching && !state && !attachError && !budgetIssue) return null;

  return (
    <div className={`bg-muted/50 text-muted-foreground ${className ?? ''}`}>
      {budgetIssue ? (
        <div className="flex items-center justify-between gap-3">
          <span>{assetMaterializationBudgetLabel(budgetIssue, labels)}</span>
          <button
            type="button"
            disabled={budgetIncreasing}
            onClick={onBudgetRetry}
            className="text-primary hover:text-primary/80 shrink-0 font-medium disabled:opacity-50"
          >
            {budgetIncreasing
              ? labels.budgetIncreaseRetrying
              : labels.budgetIncreaseAction}
          </button>
        </div>
      ) : (
        (attachError ?? materializationStatusLabel(state, labels))
      )}
    </div>
  );
}

function materializationStatusLabel(
  state: AssetMaterializationState | null,
  labels: AssetMaterializationNoticeLabels,
): string {
  if (!state) return labels.materializePreparing;
  if (state.derivative?.status === 'ready') {
    return labels.materializeDerivativeReady.replace(
      '{name}',
      state.derivative.name,
    );
  }
  if (state.derivative?.status === 'error') {
    return labels.materializeDerivativeFailed
      .replace('{name}', state.derivative.name)
      .replace('{message}', state.derivative.message ?? labels.error);
  }
  if (state.status === 'error') {
    return labels.materializeFailed.replace(
      '{message}',
      state.message ?? labels.error,
    );
  }
  if (state.status === 'complete') return labels.materializeComplete;
  if (typeof state.percent === 'number') {
    return labels.materializeProgress.replace(
      '{percent}',
      String(Math.round(state.percent)),
    );
  }
  return labels.materializePreparing;
}
