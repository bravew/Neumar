import type { Artifact } from '@/components/artifacts/types';
import type { MediaAsset } from '@/shared/lib/provenance';

const INLINE_OUTPUT_TYPES = new Set(['image', 'video', 'audio']);
const RENDER_FRAME_NAME_RE = /^frame_(?:%0?\d*d|\d+)\.(?:png|jpe?g|webp)$/i;

export interface OutputPreviewGroup {
  key: string;
  outputs: Artifact[];
  sourceAttachments: Artifact[];
}

export interface ExtractedMediaBuckets {
  videos: MediaAsset[];
  images: MediaAsset[];
  pdfs: MediaAsset[];
  documents: MediaAsset[];
}

export function getPreviewableOutputArtifacts(artifacts: Artifact[] = []) {
  const seen = new Set<string>();
  const result: Artifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact.isOutput || !artifact.path) continue;
    if (!INLINE_OUTPUT_TYPES.has(artifact.type)) continue;
    if (artifact.type === 'image' && RENDER_FRAME_NAME_RE.test(artifact.name)) {
      continue;
    }
    const key = artifact.path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(artifact);
  }
  return result;
}

export function getOutputPreviewGroups(
  artifacts: Artifact[] = [],
): OutputPreviewGroup[] {
  const groups = new Map<string, OutputPreviewGroup>();
  const sourceAttachments = artifacts.filter(isPreviewableSourceAttachment);

  for (const output of getPreviewableOutputArtifacts(artifacts)) {
    const key = outputGroupKey(output);
    const group = groups.get(key) ?? {
      key,
      outputs: [],
      sourceAttachments: [],
    };
    group.outputs.push(output);
    groups.set(key, group);
  }

  for (const source of sourceAttachments) {
    const key = sourceGroupKey(source);
    if (!key) continue;
    const group = groups.get(key);
    if (!group) continue;
    if (
      !group.sourceAttachments.some(
        (existing) =>
          (existing.path ?? existing.id) === (source.path ?? source.id),
      )
    ) {
      group.sourceAttachments.push(source);
    }
  }

  return [...groups.values()];
}

function getOutputArtifactPaths(artifacts: Artifact[] | undefined) {
  const paths = new Set<string>();
  for (const artifact of getPreviewableOutputArtifacts(artifacts)) {
    if (artifact.path) paths.add(artifact.path);
  }
  return paths;
}

export function filterOutputArtifactMedia<T extends ExtractedMediaBuckets>(
  media: T,
  artifacts: Artifact[] | undefined,
): T {
  const outputPaths = getOutputArtifactPaths(artifacts);
  if (outputPaths.size === 0) return media;
  return {
    ...media,
    videos: media.videos.filter((asset) => !outputPaths.has(asset.path)),
    images: media.images.filter((asset) => !outputPaths.has(asset.path)),
    pdfs: media.pdfs.filter((asset) => !outputPaths.has(asset.path)),
    documents: media.documents.filter((asset) => !outputPaths.has(asset.path)),
  };
}

function isPreviewableSourceAttachment(artifact: Artifact): boolean {
  return (
    artifact.isSourceAttachment === true &&
    !!artifact.path &&
    INLINE_OUTPUT_TYPES.has(artifact.type)
  );
}

function outputGroupKey(artifact: Artifact): string {
  return (
    artifact.runId ?? artifact.sourceToolCallId ?? artifact.path ?? artifact.id
  );
}

function sourceGroupKey(artifact: Artifact): string | undefined {
  return artifact.runId ?? artifact.sourceToolCallId;
}
