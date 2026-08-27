import { useCallback, useEffect, useRef, useState } from 'react';

import { useSearchParams } from 'react-router-dom';

import { toast } from 'sonner';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { PreviewViewMode } from './OutputReview';

/**
 * Which artefact the canvas is showing: the live timeline simulation, or the
 * file the last render produced.
 *
 * A finished render is what the user asked for, so it takes over the canvas
 * the moment it lands — but only until they choose a view themselves. Once
 * they have, the choice is theirs and a later render must not pull them out of
 * it.
 */
export function usePreviewViewMode(
  project: VideoProject,
  onOpenOutput?: () => void,
): {
  viewMode: PreviewViewMode;
  onViewModeChange: (mode: PreviewViewMode) => void;
} {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  // Arriving on the Export stage means you came here for the file, not the
  // timeline simulation.
  const [viewMode, setViewMode] = useState<PreviewViewMode>(() =>
    searchParams.get('stage') === 'export' ? 'output' : 'preview',
  );
  const touched = useRef(false);
  const status = project.render?.status;
  const stamp = project.render?.updatedAt;
  // Announce a finish once per render, not once per re-render of this
  // component — `stamp` changes only when the render itself does. Seeded on
  // the first pass so a render that had already finished when this view
  // mounted counts as history rather than news; one that was still running
  // then is news when it lands.
  const announced = useRef<{ stamp?: string } | null>(null);
  announced.current ??= {
    stamp: status === 'done' ? (stamp ?? '') : undefined,
  };
  const openRef = useRef(onOpenOutput);
  openRef.current = onOpenOutput;

  useEffect(() => {
    if (status !== 'done') return;
    if (!touched.current) setViewMode('output');
    const seen = announced.current;
    if (!seen || seen.stamp === (stamp ?? '')) return;
    seen.stamp = stamp ?? '';
    toast.success(t.video.editor.preview.renderComplete, {
      action: openRef.current
        ? {
            label: t.video.editor.preview.openOutput,
            onClick: () => openRef.current?.(),
          }
        : undefined,
    });
  }, [status, stamp, t.video.editor.preview]);

  const onViewModeChange = useCallback((next: PreviewViewMode) => {
    touched.current = true;
    setViewMode(next);
  }, []);

  return { viewMode, onViewModeChange };
}
