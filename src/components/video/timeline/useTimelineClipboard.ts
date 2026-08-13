import { useCallback } from 'react';

import {
  buildTimelineClipboardPayload,
  decodeTimelineClipboardPayload,
  encodeTimelineClipboardPayload,
  getInMemoryTimelineClipboard,
  setInMemoryTimelineClipboard,
} from './timelineClipboard';
import { useTimelineEditorStore } from './useTimelineEditorStore';

interface UseTimelineClipboardOptions {
  playheadMs: number;
}

export function useTimelineClipboard({
  playheadMs,
}: UseTimelineClipboardOptions) {
  const timeline = useTimelineEditorStore((state) => state.timeline);
  const selectedClipIds = useTimelineEditorStore(
    (state) => state.selectedClipIds,
  );
  const deleteSelectedClip = useTimelineEditorStore(
    (state) => state.deleteSelectedClip,
  );
  const pasteClipboardPayload = useTimelineEditorStore(
    (state) => state.pasteClipboardPayload,
  );

  const copy = useCallback(async () => {
    if (!timeline) return false;
    const payload = buildTimelineClipboardPayload(timeline, selectedClipIds);
    if (!payload) return false;
    setInMemoryTimelineClipboard(payload);
    await writeSystemClipboard(encodeTimelineClipboardPayload(payload));
    return true;
  }, [selectedClipIds, timeline]);

  const cut = useCallback(async () => {
    const copied = await copy();
    if (copied) deleteSelectedClip();
    return copied;
  }, [copy, deleteSelectedClip]);

  const paste = useCallback(async () => {
    const payload =
      (await readSystemClipboardPayload()) ?? getInMemoryTimelineClipboard();
    if (!payload) return false;
    return pasteClipboardPayload(payload, playheadMs);
  }, [pasteClipboardPayload, playheadMs]);

  return { copy, cut, paste };
}

async function writeSystemClipboard(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // In-memory clipboard remains available when system permissions are absent.
  }
}

async function readSystemClipboardPayload() {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return null;
  }
  try {
    return decodeTimelineClipboardPayload(await navigator.clipboard.readText());
  } catch {
    return null;
  }
}
