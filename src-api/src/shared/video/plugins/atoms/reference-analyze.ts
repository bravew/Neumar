import {
  executeReferenceRun,
  readReferenceRun,
  startReferenceRun,
  type StartReferenceRunInput,
} from '@/shared/video/reference/run';
import type { ReferenceRun } from '@/shared/video/types';

/** Plugin atom `reference-analyze`: run the deterministic evidence pipeline. */
export async function runReferenceAnalyzeAtom(
  projectId: string,
  referenceId: string,
  input: StartReferenceRunInput = {},
): Promise<ReferenceRun> {
  if (!(await readReferenceRun(projectId, referenceId))) {
    await startReferenceRun(projectId, referenceId, input);
  }
  return executeReferenceRun(projectId, referenceId, input.handlers);
}
