import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoTransitionKind } from '@/shared/types/video';
import {
  normalizeVideoTransition,
  VIDEO_TRANSITION_REGISTRY,
  videoTransitionRegistryEntry,
} from '@/shared/types/video';

import type { TimelineTransitionSeamContext } from './transitionInspectorModel';

type ClipInspectorLabels = ReturnType<
  typeof useLanguage
>['t']['video']['editor']['clipInspector'];

interface VisualClipTransitionSummaryProps {
  contexts: {
    incoming: TimelineTransitionSeamContext | null;
    outgoing: TimelineTransitionSeamContext | null;
  };
  labels: ClipInspectorLabels;
  transitionNames: Record<VideoTransitionKind, string>;
  onSelectSeam: (seamId: string) => void;
}

export function VisualClipTransitionSummary({
  contexts,
  labels,
  transitionNames,
  onSelectSeam,
}: VisualClipTransitionSummaryProps) {
  return (
    <section className="space-y-2">
      <h4 className="text-foreground text-[11px] font-semibold uppercase">
        {labels.sections.transition}
      </h4>
      <div className="grid gap-2">
        <TransitionSummaryRow
          title={labels.transitionIncoming}
          context={contexts.incoming}
          labels={labels}
          transitionNames={transitionNames}
          onSelectSeam={onSelectSeam}
        />
        <TransitionSummaryRow
          title={labels.transitionOutgoing}
          context={contexts.outgoing}
          labels={labels}
          transitionNames={transitionNames}
          onSelectSeam={onSelectSeam}
        />
      </div>
    </section>
  );
}

export function buildTransitionNames(
  messages: Record<string, string>,
): Record<VideoTransitionKind, string> {
  return Object.fromEntries(
    VIDEO_TRANSITION_REGISTRY.map((entry) => [
      entry.kind,
      messages[entry.labelKey.replace('transitions.', '')] ?? entry.kind,
    ]),
  ) as Record<VideoTransitionKind, string>;
}

function TransitionSummaryRow({
  title,
  context,
  labels,
  transitionNames,
  onSelectSeam,
}: {
  title: string;
  context: TimelineTransitionSeamContext | null;
  labels: ClipInspectorLabels;
  transitionNames: Record<VideoTransitionKind, string>;
  onSelectSeam: (seamId: string) => void;
}) {
  if (!context) {
    return (
      <div className="border-border bg-muted/20 rounded-md border px-2 py-1.5 text-xs">
        <span className="text-muted-foreground">{title}</span>
        <span className="text-muted-foreground block">
          {labels.transitionNoAdjacent}
        </span>
      </div>
    );
  }
  const transition = normalizeVideoTransition(context.seam.transition ?? 'cut');
  const value = context.seam.transition
    ? `${transitionNames[transition.kind]} · ${
        transition.durationMs ??
        videoTransitionRegistryEntry(transition.kind).defaultDurationMs
      } ms`
    : labels.transitionNone;
  return (
    <button
      type="button"
      className="border-border bg-background hover:border-primary/60 grid min-w-0 gap-0.5 rounded-md border px-2 py-1.5 text-left"
      onClick={() => onSelectSeam(context.seam.seamId)}
    >
      <span className="text-muted-foreground text-[11px]">{title}</span>
      <span className="text-foreground truncate text-xs font-medium">
        {value}
      </span>
    </button>
  );
}
