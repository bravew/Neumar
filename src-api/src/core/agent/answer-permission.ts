import { resolveHostToolPermission } from './tool-permission-registry';

/**
 * Answers one open tool-permission prompt, whichever adapter is waiting on it.
 * Returns false when no adapter holds the request, or it belongs to another
 * session than the caller named.
 */
export async function answerPermissionRequest(input: {
  requestId: string;
  approved: boolean;
  alwaysAllow?: boolean;
  sessionId?: string;
}): Promise<boolean> {
  const { resolvePermission } = await import('@/extensions/agent/claude/index');
  if (
    resolvePermission(
      input.requestId,
      input.approved,
      input.alwaysAllow,
      input.sessionId,
    )
  ) {
    return true;
  }
  return resolveHostToolPermission(
    input.requestId,
    input.approved,
    input.alwaysAllow,
    input.sessionId,
  );
}
