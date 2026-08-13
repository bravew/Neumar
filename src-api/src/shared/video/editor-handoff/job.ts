import { getProject } from '@/shared/video/store';
import type { VideoJob } from '@/shared/video/types';

import { createEditorHandoffPackage } from './package';
import type {
  EditorHandoffMediaMode,
  EditorHandoffPackageResult,
  EditorHandoffTarget,
} from './types';
import { EDITOR_HANDOFF_TARGETS } from './types';

export interface EditorHandoffJobPayload {
  targets?: EditorHandoffTarget[];
  mediaMode?: EditorHandoffMediaMode;
}

export async function runEditorHandoffJob(
  job: VideoJob,
): Promise<Record<string, unknown>> {
  const payload = editorHandoffPayload(job.payload);
  const project = await getProject(job.projectId);
  const result: EditorHandoffPackageResult = await createEditorHandoffPackage(
    project,
    {
      jobId: job.id,
      targets: payload.targets,
      mediaMode: payload.mediaMode,
    },
  );
  return {
    packageDir: result.packageDir,
    packagePath: result.packagePath,
    manifestPath: result.manifestPath,
    targets: result.targets,
    conformance: result.conformance.summary,
  };
}

export function editorHandoffPayload(
  payload: Record<string, unknown>,
): EditorHandoffJobPayload {
  const targets = Array.isArray(payload.targets)
    ? payload.targets.filter(
        (target): target is EditorHandoffTarget =>
          typeof target === 'string' &&
          EDITOR_HANDOFF_TARGETS.includes(target as EditorHandoffTarget),
      )
    : undefined;
  return {
    targets,
    mediaMode: payload.mediaMode === 'link' ? 'link' : 'copy',
  };
}
