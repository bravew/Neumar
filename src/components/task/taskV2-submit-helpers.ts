import { API_BASE_URL } from '@/config';
import { prependAttachmentSourceContext } from '@/shared/hooks/agent-attachment-context';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { resolveFileAttachments } from '@/shared/lib/attachments';
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

/**
 * Resolve user-supplied attachments to disk-backed references before
 * submission.
 *
 * **Tauri desktop fast path:** when the drop event came from the Tauri
 * `onDragDropEvent` listener, the attachment already carries an absolute OS
 * path *and* we've granted Tauri-scope read access to it at drop time
 * (`grantFileReadAccess` in `useChatInputFiles`). The agent's sandbox is
 * separately widened via `deriveAttachmentDirs` → `additionalWorkDirs`, so
 * the file is reachable without ever copying it into the session folder.
 * This keeps large video drops (gigabytes) instant and disk-cheap.
 *
 * **Browser / paste / file-picker:** the attachment arrives as an in-memory
 * `File` with no path. Stage it through the backend (`/files/attachment-save`)
 * which writes it into the session attachments folder.
 *
 * Fails open on any error — the user's message should still send rather than
 * being blocked by an attachment bookkeeping failure.
 */
export async function resolveAttachmentsForSubmit(
  attachments: MessageAttachment[] | undefined,
  taskId: string | undefined,
  taskWorkDir: string | undefined,
): Promise<MessageAttachment[] | undefined> {
  if (!attachments?.length || !taskId) return attachments;

  // Tauri desktop: split into path-backed (from drag-drop) and the rest
  // (paste / file picker / browser File objects). The path-backed subset is
  // passed through as-is — the OS path is already readable thanks to
  // `grantFileReadAccess`, and the agent sandbox is widened separately via
  // `deriveAttachmentDirs`. The path-less subset still needs to be staged
  // through the backend like in browser mode. This keeps mixed messages
  // (e.g. dropped video + pasted screenshot) cheap on disk for the dropped
  // file while still persisting the pasted one.
  const inTauri = isTauriRuntime();
  const pathBacked = new Set<string>();
  if (inTauri) {
    for (const a of attachments) {
      if (typeof a.path === 'string' && a.path.length > 0) {
        pathBacked.add(a.id);
      }
    }
    if (pathBacked.size === attachments.length) {
      // All attachments are path-backed — skip the resolver entirely.
      return attachments.map((a) => ({ ...a, file: undefined }));
    }
  }

  const needsBackendStaging = attachments.filter((a) => !pathBacked.has(a.id));
  if (needsBackendStaging.length === 0) {
    return attachments.map((a) => ({ ...a, file: undefined }));
  }

  const sessionFolder = await computeSessionFolder(taskId, taskWorkDir);
  if (!sessionFolder) {
    console.warn(
      '[taskV2-submit] No session folder resolved; submitting without attachment resolution',
    );
    return attachments;
  }

  // Always run resolveFileAttachments — it short-circuits per-attachment when
  // `path` is already inside the session/workDir (no copy), and stages
  // anything else through the backend.
  try {
    const refs = await resolveFileAttachments(
      needsBackendStaging,
      sessionFolder,
      taskWorkDir,
      { taskId, workDir: taskWorkDir },
    );
    const refById = new Map(refs.map((r) => [r.id, r]));
    const dropped: string[] = [];
    const resolved = attachments.map((a) => {
      // Path-backed Tauri attachments pass through untouched (no copy).
      if (pathBacked.has(a.id)) {
        return { ...a, file: undefined };
      }
      const ref = refById.get(a.id);
      if (!ref) {
        dropped.push(a.name);
        return a;
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
    if (dropped.length > 0) {
      // Surface in production too — a silently dropped attachment leaves
      // the chip rendered (we still persist the message row) but the agent
      // never sees the file in its [ATTACHED FILES …] prefix.
      console.error(
        '[taskV2-submit] Attachment staging failed; agent will not see:',
        dropped,
      );
    }
    return resolved;
  } catch (err) {
    console.error(
      '[taskV2-submit] resolveFileAttachments threw; submitting without resolution:',
      err,
    );
    return attachments;
  }
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
