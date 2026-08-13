import { History, RotateCcw, Save, Undo2 } from 'lucide-react';

import type {
  InspectStyleProp,
  NeumaTargetPayload,
} from '@/components/artifacts/live/iframe-sandbox';
import { Button } from '@/components/ui/button';

import {
  isAppliedManualEditPatch,
  MANUAL_EDIT_STYLE_PROPS,
  type ManualEditState,
} from './manual-edit-reducer';
import { ManualEditHistoryDialog } from './ManualEditHistoryDialog';

interface ManualEditPanelProps {
  target: NeumaTargetPayload | null;
  availableTargets?: NeumaTargetPayload[];
  state: ManualEditState;
  saving: boolean;
  labels: {
    title: string;
    noSelection: string;
    property: string;
    value: string;
    apply: string;
    saving: string;
    history: string;
    emptyHistory: string;
    revert: string;
    reapply: string;
    historyDescription: string;
    historyApplied: string;
    historyReverted: string;
  };
  onDraftChange: (property: InspectStyleProp, value: string) => void;
  onTargetSelect?: (target: NeumaTargetPayload) => void;
  onApply: () => void;
  onRevert: (patchId: string) => void;
  onReapply: (patchId: string) => void;
  onHistoryOpenChange: (open: boolean) => void;
}

export function ManualEditPanel({
  target,
  availableTargets = [],
  state,
  saving,
  labels,
  onDraftChange,
  onTargetSelect,
  onApply,
  onRevert,
  onReapply,
  onHistoryOpenChange,
}: ManualEditPanelProps) {
  const appliedEntries = state.entries.filter(isAppliedManualEditPatch);
  const disabled = saving || !target || !state.draft.value.trim();

  return (
    <aside className="bg-card w-80 shrink-0 overflow-auto border-l p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{labels.title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.history}
          onClick={() => onHistoryOpenChange(true)}
        >
          <History className="size-4" />
        </Button>
      </div>
      {!target ? (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-xs">{labels.noSelection}</p>
          {availableTargets.length > 0 && onTargetSelect && (
            <div className="max-h-72 space-y-1 overflow-auto">
              {availableTargets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="hover:bg-accent w-full rounded-md border px-2 py-1.5 text-left"
                  onClick={() => onTargetSelect(item)}
                >
                  <span className="block truncate text-xs font-medium">
                    {item.label || item.id}
                  </span>
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {item.tagName.toLowerCase()} · {item.id}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border p-2">
            <p className="truncate text-xs font-medium">
              {target.label || target.id}
            </p>
            <p className="text-muted-foreground mt-1 truncate text-[11px]">
              {target.tagName.toLowerCase()} · {target.id}
            </p>
          </div>
          <label className="block text-xs font-medium">
            {labels.property}
            <select
              value={state.draft.property}
              onChange={(event) =>
                onDraftChange(
                  event.target.value as InspectStyleProp,
                  target.styles?.[event.target.value as InspectStyleProp] ?? '',
                )
              }
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
            >
              {MANUAL_EDIT_STYLE_PROPS.map((property) => (
                <option key={property} value={property}>
                  {property}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium">
            {labels.value}
            <input
              value={state.draft.value}
              onChange={(event) =>
                onDraftChange(state.draft.property, event.target.value)
              }
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
            />
          </label>
          <Button type="button" size="sm" disabled={disabled} onClick={onApply}>
            <Save className="size-4" />
            {saving ? labels.saving : labels.apply}
          </Button>
        </div>
      )}
      <div className="mt-4 border-t pt-3">
        <p className="text-xs font-medium">{labels.history}</p>
        {appliedEntries.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {labels.emptyHistory}
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {appliedEntries.slice(0, 6).map((entry) => (
              <li key={entry.patchId} className="rounded-md border p-2">
                <p className="truncate text-xs font-medium">
                  {entry.patch.targetId ?? entry.sourcePath}
                </p>
                <p className="text-muted-foreground mt-1 truncate text-[11px]">
                  {entry.patch.type} · {entry.appliedAt}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onRevert(entry.patchId)}
                  >
                    <Undo2 className="size-3.5" />
                    {labels.revert}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onReapply(entry.patchId)}
                  >
                    <RotateCcw className="size-3.5" />
                    {labels.reapply}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <ManualEditHistoryDialog
        open={state.historyOpen}
        entries={state.entries}
        labels={{
          title: labels.history,
          description: labels.historyDescription,
          empty: labels.emptyHistory,
          applied: labels.historyApplied,
          reverted: labels.historyReverted,
        }}
        onOpenChange={onHistoryOpenChange}
      />
    </aside>
  );
}
