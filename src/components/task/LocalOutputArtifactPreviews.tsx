import { useCallback, useEffect, useMemo, useState } from 'react';

import { getStreamUrl } from '@/components/artifacts/media-loader';
import type { Artifact } from '@/components/artifacts/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { MediaLightbox } from './MediaLightbox';
import { getOutputPreviewGroups } from './outputArtifactMedia';

function artifactKey(artifact: Artifact): string {
  return artifact.path ?? artifact.id;
}

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
  // Output artifacts are tracked once (e.g. from a tool call) and never
  // re-synced against the filesystem, so a scratch file the agent later
  // deletes (spot-check frames, cleanup after a final render) stays in this
  // list forever. Track load failures here and drop those entries — and any
  // group/wrapper left empty as a result — instead of showing a broken
  // thumbnail or an empty bordered box.
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markFailed = useCallback((key: string) => {
    setFailedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          outputs: group.outputs.filter((a) => !failedKeys.has(artifactKey(a))),
          sourceAttachments: group.sourceAttachments.filter(
            (a) => !failedKeys.has(artifactKey(a)),
          ),
        }))
        .filter(
          (group) =>
            group.outputs.length > 0 || group.sourceAttachments.length > 0,
        ),
    [groups, failedKeys],
  );

  if (visibleGroups.length === 0) return null;

  return (
    <div className="border-ai-response rounded-xl border-l-2 pl-3">
      <div className="flex max-w-full flex-col gap-2">
        {visibleGroups.map((group) => (
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
                  key={artifactKey(artifact)}
                  artifact={artifact}
                  revision={revision}
                  onOpen={() => setLightboxArtifact(artifact)}
                  onError={() => markFailed(artifactKey(artifact))}
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
                      key={artifactKey(artifact)}
                      artifact={artifact}
                      revision={revision}
                      compact
                      onOpen={() => setLightboxArtifact(artifact)}
                      onError={() => markFailed(artifactKey(artifact))}
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
  onError,
}: {
  artifact: Artifact;
  revision: number;
  compact?: boolean;
  onOpen: () => void;
  onError: () => void;
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
          onError={onError}
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
          onError={onError}
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
          onError={onError}
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
