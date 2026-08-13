import type { DesignProject } from '@/shared/types/design-mode';

export function firstReviewableArtifactPath(project: DesignProject) {
  return project.outputs.find((output) =>
    /\.(html?|md|markdown|txt)$/i.test(output.path),
  )?.path;
}
