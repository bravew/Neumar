import { useEffect, useMemo, useState } from 'react';

import { getStreamUrl } from '@/components/artifacts/media-loader';
import type { Artifact } from '@/components/artifacts/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { MediaLightbox } from './MediaLightbox';
import { getOutputPreviewGroups } from './outputArtifactMedia';

export function LocalOutputArtifactPreviews({
  artifacts,
}: {
  artifacts: Artifact[];
}) {
  const { t } = useLanguage();
  const groups = useMemo(() => getOutputPreviewGroups(artifacts), [artifacts]);
  const [lightboxArtifact, setLightboxArtifact] = useState<Artifact | null>(
    null,
  );
  const revision = useOutputArtifactRevision(groups.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="border-ai-response rounded-xl border-l-2 pl-3">
      <div className="flex max-w-full flex-col gap-2">
        {groups.map((group) => (
          <div
            key={group.key}
            className={cn(
              'grid max-w-full gap-2',
              group.sourceAttachments.length > 0 &&
                'md:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)]',
            )}
          >
            <div className="flex max-w-full flex-col gap-2">
              {group.outputs.map((artifact) => (
                <InlineOutputArtifact
                  key={artifact.path ?? artifact.id}
                  artifact={artifact}
                  revision={revision}
                  onOpen={() => setLightboxArtifact(artifact)}
                />
              ))}
            </div>
            {group.sourceAttachments.length > 0 && (
              <div className="border-border/60 bg-muted/20 rounded-lg border p-2">
                <div className="text-muted-foreground mb-2 text-xs font-medium">
                  {t.task.sourceAttachments}
                </div>
                <div className="flex flex-col gap-2">
                  {group.sourceAttachments.map((artifact) => (
                    <InlineOutputArtifact
                      key={artifact.path ?? artifact.id}
                      artifact={artifact}
                      revision={revision}
                      compact
                      onOpen={() => setLightboxArtifact(artifact)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {lightboxArtifact?.path && (
        <MediaLightbox
          src={getStreamUrl(lightboxArtifact.path, revision)}
          alt={lightboxArtifact.name}
          type="image"
          onClose={() => setLightboxArtifact(null)}
        />
      )}
    </div>
  );
}

function InlineOutputArtifact({
  artifact,
  revision,
  compact,
  onOpen,
}: {
  artifact: Artifact;
  revision: number;
  compact?: boolean;
  onOpen: () => void;
}) {
  const src = artifact.path ? getStreamUrl(artifact.path, revision) : '';

  if (artifact.type === 'video') {
    return (
      <figure className="max-w-full">
        <video
          key={src}
          className={cn(
            'border-border/70 max-w-full rounded-lg border bg-black',
            compact ? 'max-h-28' : 'max-h-80',
          )}
          src={src}
          aria-label={artifact.name}
          controls
          preload="metadata"
        />
        <figcaption className="text-muted-foreground mt-1 truncate text-xs">
          {artifact.name}
        </figcaption>
      </figure>
    );
  }

  if (artifact.type === 'audio') {
    return (
      <figure className="max-w-full">
        <audio
          key={src}
          src={src}
          aria-label={artifact.name}
          controls
          preload="metadata"
          className="w-full"
        />
        <figcaption className="text-muted-foreground mt-1 truncate text-xs">
          {artifact.name}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="max-w-full">
      <button
        type="button"
        className="block max-w-full cursor-zoom-in"
        onClick={onOpen}
        aria-label={artifact.name}
      >
        <img
          src={src}
          alt={artifact.name}
          className={cn(
            'border-border/70 bg-muted max-w-full rounded-lg border object-contain',
            compact ? 'max-h-28' : 'max-h-80',
          )}
        />
      </button>
      <figcaption className="text-muted-foreground mt-1 truncate text-xs">
        {artifact.name}
      </figcaption>
    </figure>
  );
}

function useOutputArtifactRevision(active: boolean) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const handleUpdate = () => setRevision((current) => current + 1);
    window.addEventListener('task-files-updated', handleUpdate);
    return () => window.removeEventListener('task-files-updated', handleUpdate);
  }, [active]);
  return revision;
}
