import type { PromptLibrarySample } from '@/shared/design/prompt-library-types';
import { updateDesignProject } from '@/shared/hooks/useDesignMode';
import type { DesignProject } from '@/shared/types/design-mode';

export async function applyPromptLibrarySample(
  project: DesignProject,
  sample: PromptLibrarySample,
): Promise<DesignProject> {
  const brief = {
    ...project.brief,
    prompt: sample.prompt,
    createdFromPromptLibrary: true,
    promptLibraryRepoSlug: sample._meta.repoSlug,
    promptLibrarySampleId: sample._meta.sampleId,
    promptLibrarySampleSlug: sample._meta.sampleSlug,
    promptLibraryVersion: sample._meta.version,
  };
  const { project: next } = await updateDesignProject(project.id, {
    brief,
    media: {
      ...project.media,
      ...(sample.model ? { model: sample.model } : {}),
      ...(sample.aspect ? { aspect: sample.aspect } : {}),
    },
    promptTemplate: sample,
  });
  return next;
}
