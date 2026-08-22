/**
 * Audio problems are not picture problems.
 *
 * `WebCodecsPreview`'s `onUnsupported` retires the WebCodecs renderer for the
 * rest of the session, so routing an audio failure through it silently
 * downgraded the live preview to the Remotion player — which is what happened
 * for any clip whose scrub proxy carries no audio track (the proxy is
 * generated with `-an`). Playback degrades to silence instead.
 */
export function reportPreviewAudioFailure(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  if (!import.meta.env.DEV) return;
  console.warn(
    '[WebCodecsPreview] audio unavailable, continuing without sound:',
    error instanceof Error ? error.message : error,
  );
}
