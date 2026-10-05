import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { getSettings } from '@/shared/db/settings';
import { prependAttachmentSourceContext } from '@/shared/hooks/agent-attachment-context';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import {
  type AttachmentReference,
  type AttachmentStagingFailure,
  resolveFileAttachments,
} from '@/shared/lib/attachments';
import { computeSessionFolder } from '@/shared/lib/session';
import { isTauriRuntime } from '@/shared/utils/tauri';

/** Parent directory of an absolute path. Handles both POSIX (`/`) and
 *  Windows (`\`) separators since Tauri drops surface native OS paths.
 *  Returns an empty string when the input is unusable so callers can
 *  filter cleanly. */
function parentDirOf(absPath: string | undefined): string {
  if (!absPath || typeof absPath !== 'string') return '';
  // Take the rightmost of either separator — handles mixed `C:/a\b` too.
  const lastFwd = absPath.lastIndexOf('/');
  const lastBwd = absPath.lastIndexOf('\\');
  const idx = Math.max(lastFwd, lastBwd);
  if (idx <= 0) return '';
  return absPath.slice(0, idx);
}

/**
 * Collect the parent directories of every attachment that carries an
 * absolute path. Used by the submit path to widen the agent's sandbox
 * (`additionalWorkDirs`) so it can `Read` dropped files without us having
 * to copy them into the session folder.
 */
export function deriveAttachmentDirs(
  attachments: MessageAttachment[] | undefined,
): string[] {
  if (!attachments?.length) return [];
  const dirs = new Set<string>();
  for (const a of attachments) {
    const dir = parentDirOf(a.path);
    if (dir) dirs.add(dir);
  }
  return [...dirs];
}

/** Outcome of staging attachments before a submit. */
export interface ResolvedSubmitAttachments {
  attachments: MessageAttachment[] | undefined;
  /** Attachments the agent would not see; the caller must not send. */
  failures: AttachmentStagingFailure[];
}

/** An image with inline data still reaches the model via `imageBlocks`. */
function reachesAgentWithoutPath(a: MessageAttachment): boolean {
  return a.type === 'image' && !!a.data;
}

/**
 * Resolve user-supplied attachments to disk-backed references before
 * submission.
 *
 * **Tauri desktop fast path:** attachments picked with the native dialog or
 * dropped from Finder carry an absolute OS path, and we've granted
 * Tauri-scope read access to it (`grantFileReadAccess` in
 * `useChatInputFiles`). The agent's sandbox is separately widened via
 * `deriveAttachmentDirs` → `additionalWorkDirs`, so the file is read in place
 * without ever being copied into the session folder. This keeps large video
 * attachments (gigabytes) instant and disk-cheap.
 *
 * **Browser / paste:** the attachment arrives as an in-memory `File` with no
 * path. Stage it through the backend (`/files/attachment-save`) which writes
 * it into the session attachments folder.
 *
 * Any attachment the agent would not be able to see is reported in
 * `failures` so the caller can stop the send and tell the user, instead of
 * running the agent on a message whose file silently went missing.
 */
export async function resolveAttachmentsForSubmit(
  attachments: MessageAttachment[] | undefined,
  taskId: string | undefined,
  taskWorkDir: string | undefined,
): Promise<ResolvedSubmitAttachments> {
  if (!attachments?.length || !taskId) return { attachments, failures: [] };

  // Tauri desktop: split into path-backed (native picker / drag-drop) and the
  // rest (paste / browser File objects). The path-backed subset is passed
  // through as-is — the OS path is already readable thanks to
  // `grantFileReadAccess`, and the agent sandbox is widened separately via
  // `deriveAttachmentDirs`. The path-less subset still needs to be staged
  // through the backend like in browser mode.
  const inTauri = isTauriRuntime();
  const pathBacked = new Set<string>();
  if (inTauri) {
    for (const a of attachments) {
      if (typeof a.path === 'string' && a.path.length > 0) {
        pathBacked.add(a.id);
      }
    }
  }

  const needsBackendStaging = attachments.filter((a) => !pathBacked.has(a.id));
  if (needsBackendStaging.length === 0) {
    return {
      attachments: attachments.map((a) => ({ ...a, file: undefined })),
      failures: [],
    };
  }

  const reported = new Map<string, AttachmentStagingFailure>();
  let refById = new Map<string, AttachmentReference>();
  const sessionFolder = await computeSessionFolder(taskId, taskWorkDir);
  if (sessionFolder) {
    // resolveFileAttachments short-circuits per-attachment when `path` is
    // already inside the session/workDir (no copy), and stages anything else
    // through the backend.
    try {
      const refs = await resolveFileAttachments(
        needsBackendStaging,
        sessionFolder,
        taskWorkDir,
        {
          taskId,
          workDir: taskWorkDir,
          onFailure: (failure) => reported.set(failure.id, failure),
        },
      );
      refById = new Map(refs.map((r) => [r.id, r]));
    } catch (err) {
      console.error('[taskV2-submit] resolveFileAttachments threw:', err);
    }
  } else {
    console.error('[taskV2-submit] No session folder resolved for attachments');
  }

  const failures: AttachmentStagingFailure[] = [];
  const resolved = attachments.map((a) => {
    // Path-backed Tauri attachments pass through untouched (no copy).
    if (pathBacked.has(a.id)) return { ...a, file: undefined };
    const ref = refById.get(a.id);
    if (!ref) {
      if (!reachesAgentWithoutPath(a)) {
        failures.push(
          reported.get(a.id) ?? {
            id: a.id,
            name: a.name,
            reason: 'error',
            message: 'Could not save the attachment',
          },
        );
      }
      return { ...a, file: undefined };
    }
    return {
      ...a,
      path: ref.path,
      mimeType: ref.mimeType ?? a.mimeType,
      // Drop the File object — it's already persisted and File isn't JSON-serialisable
      // (would round-trip to `{}` in the DB row).
      file: undefined,
    };
  });
  if (failures.length > 0) {
    console.error(
      '[taskV2-submit] Attachment staging failed; not sending:',
      failures,
    );
  }
  return { attachments: resolved, failures };
}

/** User-facing explanation for one attachment that blocked a send. */
export function describeAttachmentFailure(
  failure: AttachmentStagingFailure,
  tt: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (failure.reason === 'too_large') {
    const limitMb = failure.limitBytes
      ? Math.round(failure.limitBytes / (1024 * 1024))
      : getSettings().attachmentUploadLimitMb;
    return tt('task.attachmentTooLarge', {
      name: failure.name,
      limit: limitMb,
    });
  }
  return tt('task.attachmentUploadFailed', {
    name: failure.name,
    reason: failure.message,
  });
}

/**
 * Toast every staging failure. Returns true when the caller must not send.
 */
export function notifyAttachmentFailures(
  failures: AttachmentStagingFailure[],
  tt: (key: string, params?: Record<string, string | number>) => string,
): boolean {
  for (const failure of failures) {
    toast.error(describeAttachmentFailure(failure, tt));
  }
  return failures.length > 0;
}

/**
 * Maximum length (chars) we'll accept for an `att.path` embedded into the
 * `[ATTACHED FILES …]` prompt prefix. A healthy absolute path is a few
 * hundred chars max. Anything longer almost certainly means an upstream
 * bug leaked binary/data-URI content into the `path` field, which — when
 * passed through to the agent — balloons the prompt, spikes RSS memory,
 * and hangs the turn (observed symptom: 3.4 GB spike + 5-min stall).
 */
const MAX_PROMPT_PATH_LEN = 4096;

/** True when `path` is safe to emit into the prompt prefix verbatim. */
function isPromptablePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= MAX_PROMPT_PATH_LEN &&
    !path.startsWith('data:')
  );
}

export function buildAgentPrompt(
  text: string,
  attachments?: MessageAttachment[],
): {
  prompt: string;
  imageBlocks: Array<{ type: 'image'; image: string }>;
} {
  let prompt = text.trim();

  // Single pass: split usable paths from rejects (logged in DEV).
  const withPaths: MessageAttachment[] = [];
  const dropped: MessageAttachment[] = [];
  for (const att of attachments ?? []) {
    if (isPromptablePath(att.path)) withPaths.push(att);
    else if (att.path) dropped.push(att);
  }
  if (import.meta.env.DEV && dropped.length > 0) {
    console.warn(
      '[taskV2-submit] Dropping attachment(s) with invalid path shape:',
      dropped.map((a) => ({
        name: a.name,
        type: a.type,
        pathPreview: a.path?.slice(0, 80),
        pathLen: a.path?.length,
      })),
    );
  }
  if (withPaths.length > 0) {
    const fileList = withPaths.map((f) => `- ${f.name}: ${f.path}`).join('\n');
    prompt =
      `[ATTACHED FILES — READ permission granted (exempt from workspace isolation). Use the Read tool directly:\n${fileList}]\n\n` +
      prompt;
  }
  prompt = prependAttachmentSourceContext(prompt, attachments);

  // For images without disk paths (browser dev mode), pass base64 via
  // forwardedProps.images so the backend sends them to Claude's vision API.
  const imageBlocks = (attachments ?? [])
    .filter((att) => att.type === 'image' && att.data && !att.path)
    .map((att) => ({
      type: 'image' as const,
      image: att.data.startsWith('data:')
        ? att.data
        : `data:${att.mimeType || 'image/png'};base64,${att.data}`,
    }));

  return { prompt, imageBlocks };
}

/** Decide whether to surface an error banner after `runAgent()` resolves.
 *  CopilotKit may resolve on RUN_ERROR without throwing, so we inspect
 *  persisted history: a stored `isError` message always wins — a run that
 *  made tool calls and then crashed still counts as failed.
 *
 *  Scoped to messages after the most recent user message (this run) —
 *  history accumulates across every run on the task, and an unscoped scan
 *  would keep re-surfacing the first run's error on every later send, even
 *  a successful one. */
export async function checkEmptyRun(
  taskId: string,
  hasAssistantOutput: boolean,
  fallbackLabel: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/ag-ui/history/${taskId}`);
    if (res.ok) {
      const data = (await res.json()) as {
        messages?: Array<{
          role: string;
          content?: string;
          isError?: boolean;
          toolCalls?: unknown[];
        }>;
      };
      const lastUserIdx =
        data.messages?.map((m) => m.role).lastIndexOf('user') ?? -1;
      const currentRunMessages =
        lastUserIdx >= 0 ? data.messages!.slice(lastUserIdx + 1) : [];
      const errorMsg = currentRunMessages.find((m) => m.isError && m.content);
      if (errorMsg?.content) return errorMsg.content;

      if (hasAssistantOutput) return null;

      const lastMsg = data.messages?.at(-1);
      if (
        (lastMsg?.role === 'assistant' &&
          (lastMsg?.content || lastMsg?.toolCalls?.length)) ||
        lastMsg?.role === 'tool'
      ) {
        return null;
      }
      return (
        fallbackLabel ??
        'The agent run completed without a response. Check the model configuration or try again.'
      );
    }
  } catch {
    /* best effort */
  }
  return null;
}
