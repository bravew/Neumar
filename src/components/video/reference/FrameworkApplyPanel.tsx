import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoFramework } from '@/shared/types/video';

import { IssueList, TimelineDiffBox } from '../TimelineOpDiffPanels';

interface BoundSlotView {
  sectionId: string;
  slot: { id: string; kind: string; required: boolean };
  chosen: { assetId: string; reason: string } | null;
  alternatives: Array<{ assetId: string; reason: string }>;
}

interface GapView {
  slotId: string;
  required: boolean;
  fallback: { kind: string };
  estimatedCents: number;
}

interface PreviewView {
  ops: Array<{ kind: string; trackId?: string }>;
  blocked: GapView[];
  gaps: GapView[];
}

interface FrameworkApplyPanelProps {
  projectId: string;
  framework: VideoFramework | null;
  stale?: boolean;
}

export function FrameworkApplyPanel({
  projectId,
  framework,
  stale = false,
}: FrameworkApplyPanelProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.apply;
  const [bindings, setBindings] = useState<BoundSlotView[]>([]);
  const [gaps, setGaps] = useState<GapView[]>([]);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  useEffect(() => {
    if (!framework || stale) return;
    const controller = new AbortController();
    void fetch(
      `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/frameworks/${encodeURIComponent(framework.id)}/bind`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as {
          bindings: BoundSlotView[];
          gaps: GapView[];
        };
        if (!controller.signal.aborted) {
          setBindings(payload.bindings);
          setGaps(payload.gaps);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [framework, projectId, stale]);
  if (!framework) {
    return <p className="text-muted-foreground text-xs">{copy.empty}</p>;
  }
  const blocked = gaps.filter((gap) => gap.required);
  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium">{copy.title}</p>
      {bindings.map((binding) => (
        <div
          key={`${binding.sectionId}:${binding.slot.id}`}
          className="border-border rounded border p-2"
        >
          <p>
            {binding.slot.kind} · {copy.chosen}:{' '}
            {binding.chosen?.assetId ?? copy.none}
          </p>
          {binding.chosen ? (
            <p className="text-muted-foreground">
              {copy.reason}: {binding.chosen.reason}
            </p>
          ) : null}
          {binding.alternatives.length > 0 ? (
            <p className="text-muted-foreground">
              {copy.alternatives}:{' '}
              {binding.alternatives.map((item) => item.assetId).join(', ')}
            </p>
          ) : null}
        </div>
      ))}
      <IssueList
        title={copy.gaps}
        items={gaps.map(
          (gap) =>
            `${gap.slotId} · ${copy.fallback} ${gap.fallback.kind} · ${copy.cost} ${gap.estimatedCents}`,
        )}
      />
      {blocked.length > 0 ? (
        <p className="text-amber-700 dark:text-amber-400">{copy.blocked}</p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="border-border hover:bg-accent rounded border px-2 py-1"
          onClick={() => {
            void fetch(
              `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/frameworks/${encodeURIComponent(framework.id)}/preview`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  targetMs: framework.totalDuration.typicalMs,
                }),
              },
            )
              .then(async (response) => {
                if (!response.ok) return;
                setPreview((await response.json()) as PreviewView);
              })
              .catch(() => undefined);
          }}
        >
          {copy.preview}
        </button>
        <button
          type="button"
          className="border-border hover:bg-accent rounded border px-2 py-1"
          disabled={blocked.length > 0 || stale}
          onClick={() => {
            void fetch(
              `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/frameworks/${encodeURIComponent(framework.id)}/apply`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  targetMs: framework.totalDuration.typicalMs,
                }),
              },
            ).catch(() => undefined);
          }}
        >
          {copy.approve}
        </button>
      </div>
      {preview?.ops?.length ? (
        <TimelineDiffBox
          labels={{
            title: copy.ops,
            operation: copy.ops,
            clip: 'clip',
            track: 'track',
            marker: 'marker',
            from: 'from',
            to: 'to',
            duration: 'ms',
            batch: copy.ops,
            operations: copy.ops,
            rippleImpact: '',
            downstreamClips: '',
            shift: '',
            milliseconds: 'ms',
            conflicts: '',
            conflictCount: '',
            warnings: '',
            beforeFrames: '',
            afterFrames: '',
            frameAt: '',
            cacheHit: '',
          }}
          rows={preview.ops.map((op) => ({
            label: op.kind,
            value: op.trackId ?? op.kind,
          }))}
        />
      ) : null}
    </div>
  );
}
