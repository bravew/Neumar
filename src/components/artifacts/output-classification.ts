import type { Artifact } from './types';
import { OUTPUT_ARTIFACT_TYPES } from './types';

const OUTPUT_DIR_NAMES = new Set(['out', 'output', 'outputs', 'dist', 'build']);
const SOURCE_DIR_NAMES = new Set(['attachments', 'inputs']);

function pathHasSegment(filePath: string | undefined, names: Set<string>) {
  if (!filePath) return false;
  return filePath.split(/[\\/]+/).some((segment) => names.has(segment));
}

export function isOutputArtifactPath(filePath: string | undefined) {
  return pathHasSegment(filePath, OUTPUT_DIR_NAMES);
}

export function isSourceArtifactPath(filePath: string | undefined) {
  return pathHasSegment(filePath, SOURCE_DIR_NAMES);
}

export function shouldTreatArtifactAsOutput(
  artifact: Artifact,
  explicitOutputPaths: ReadonlySet<string> = new Set(),
) {
  if (artifact.isSourceAttachment) return false;

  if (
    explicitOutputPaths.has(artifact.id) ||
    explicitOutputPaths.has(artifact.path ?? '')
  ) {
    return true;
  }

  if (artifact.path) {
    if (isSourceArtifactPath(artifact.path)) return false;
    return isOutputArtifactPath(artifact.path);
  }

  return OUTPUT_ARTIFACT_TYPES.has(artifact.type);
}
