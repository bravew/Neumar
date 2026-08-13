import { Check, Replace, Trash2 } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { formatElapsed } from './captureUtils';

interface CaptureReviewProps {
  review: {
    url: string;
    insertedClipId?: string;
    markers: Array<{ sceneId: string; confidence: number; startMs: number }>;
  };
  canReplace: boolean;
  onInsert: () => void;
  onReplace: () => void;
  onDiscard: () => void;
}

export function CaptureReview({
  review,
  canReplace,
  onInsert,
  onReplace,
  onDiscard,
}: CaptureReviewProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.capture.takeReview;
  return (
    <div className="space-y-2">
      <h3 className="text-foreground text-sm font-semibold">{labels.title}</h3>
      <video src={review.url} controls className="bg-muted w-full rounded-md" />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onInsert}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs"
        >
          <Check className="size-3" />
          {labels.insertAtPlayhead}
        </button>
        <button
          type="button"
          onClick={onReplace}
          disabled={!canReplace}
          className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs disabled:opacity-40"
        >
          <Replace className="size-3" />
          {labels.replaceSelected}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="border-border hover:bg-accent inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
        >
          <Trash2 className="size-3" />
          {labels.discard}
        </button>
      </div>
      {review.insertedClipId ? (
        <p className="text-success text-xs">
          {labels.inserted.replace('{clip}', review.insertedClipId)}
        </p>
      ) : null}
      {review.markers.map((marker) => (
        <div key={marker.sceneId} className="text-muted-foreground text-xs">
          {labels.detectedScene
            .replace('{scene}', marker.sceneId)
            .replace('{time}', formatElapsed(marker.startMs))}
          {' · '}
          {labels.confidence.replace(
            '{percent}',
            String(Math.round(marker.confidence * 100)),
          )}
        </div>
      ))}
    </div>
  );
}
