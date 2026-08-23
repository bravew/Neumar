import { sourceHandlePolicy } from './build-model';
import type {
  ConformanceReport,
  EditorHandoffManifest,
  EditorHandoffMediaMode,
  EditorHandoffModel,
  EditorHandoffTarget,
} from './types';

export function buildEditorHandoffManifest(input: {
  model: EditorHandoffModel;
  targets: EditorHandoffTarget[];
  mediaMode: EditorHandoffMediaMode;
  conformance: ConformanceReport;
  generatedSidecars: string[];
  checksums: Record<string, string>;
  referencePath?: string;
}): EditorHandoffManifest {
  return {
    schema: 'neuma.video.editor-handoff.manifest.v1',
    packageVersion: input.model.packageVersion,
    generatedAt: input.model.generatedAt,
    projectId: input.model.projectId,
    projectName: input.model.projectName,
    timeline: {
      schema: input.model.timelineSchema,
      fps: input.model.fps,
      durationMs: input.model.durationMs,
    },
    targets: input.targets,
    mediaMode: input.mediaMode,
    sourceHandlePolicy: sourceHandlePolicy(),
    mediaRefs: input.model.mediaRefs.map((ref) => ({
      id: ref.id,
      kind: ref.kind,
      path: ref.path,
      external: ref.external,
      copiedPath: ref.copiedPath,
      originalPathHint: ref.originalPathHint,
      checksumSha256: ref.checksumSha256,
      sizeBytes: ref.sizeBytes,
      collectionId: ref.collectionId,
      collectionLabel: ref.collectionLabel,
      provenance: ref.provenance,
      missing: ref.missing,
      relinkRequired: ref.relinkRequired,
    })),
    generatedSidecars: input.generatedSidecars,
    derivativeManifestPath: 'media/derivatives.json',
    analysisManifestPath: 'analysis/manifest.json',
    actionLogPath: 'actions/action-log.json',
    referencePath: input.referencePath,
    checksums: input.checksums,
    conformance: input.conformance.summary,
  };
}
