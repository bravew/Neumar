import type { NeumaTargetPayload } from '@/components/artifacts/live/iframe-sandbox';
import { useLanguage } from '@/shared/providers/language-provider';

import type { useManualEditSession } from '../use-manual-edit-session';
import { ManualEditPanel } from './ManualEditPanel';

export function FileViewerEditSidebar({
  target,
  availableTargets,
  manualEdit,
  onTargetSelect,
}: {
  target: NeumaTargetPayload | null;
  availableTargets: NeumaTargetPayload[];
  manualEdit: ReturnType<typeof useManualEditSession>;
  onTargetSelect: (target: NeumaTargetPayload) => void;
}) {
  const { t } = useLanguage();
  return (
    <ManualEditPanel
      target={target}
      availableTargets={availableTargets}
      state={manualEdit.state}
      saving={manualEdit.saving}
      labels={{
        title: t.design.manualEditPanelTitle,
        noSelection: t.design.manualEditNoSelection,
        property: t.design.manualEditProperty,
        value: t.design.manualEditValue,
        apply: t.design.manualEditApply,
        saving: t.design.saving,
        history: t.design.manualEditHistory,
        emptyHistory: t.design.manualEditEmptyHistory,
        revert: t.design.manualEditRevert,
        reapply: t.design.manualEditReapply,
        historyDescription: t.design.manualEditHistoryDescription,
        historyApplied: t.design.manualEditApplied,
        historyReverted: t.design.manualEditReverted,
      }}
      onDraftChange={manualEdit.updateDraft}
      onTargetSelect={onTargetSelect}
      onApply={() => void manualEdit.apply()}
      onRevert={(patchId) => void manualEdit.revert(patchId)}
      onReapply={(patchId) => void manualEdit.reapply(patchId)}
      onHistoryOpenChange={manualEdit.setHistoryOpen}
    />
  );
}
