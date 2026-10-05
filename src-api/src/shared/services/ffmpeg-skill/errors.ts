/**
 * Typed failures for the managed FFmpeg skill boundary.
 *
 * A kind is part of the result the caller sees. It is not inferred from the
 * message, so a missing interpreter, a rejected variant, and a path that left
 * the workspace stay distinguishable.
 */

export type FfmpegSkillErrorKind =
  | 'input'
  | 'unsupported'
  | 'path'
  | 'missing_runtime'
  | 'timeout'
  | 'aborted'
  | 'output_limit'
  | 'failed'
  | 'output';

export class FfmpegSkillError extends Error {
  constructor(
    public readonly kind: FfmpegSkillErrorKind,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FfmpegSkillError';
  }
}

export function isFfmpegSkillError(error: unknown): error is FfmpegSkillError {
  return error instanceof FfmpegSkillError;
}
