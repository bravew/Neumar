import { useEffect, useRef } from 'react';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import {
  getToolArgs,
  getToolName,
} from '@/components/task/TaskV2MessageBubble.types';
import { API_BASE_URL } from '@/config';
import { createFile, getFilesByTaskId } from '@/shared/db';

import { extractAndSaveFiles, getFileTypeFromPath } from './agent-files';

/** Inline-previewable types worth registering from a directory scan. */
const SCANNABLE_TYPES = new Set(['audio', 'video', 'image']);

interface ReaddirEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: ReaddirEntry[];
}

function flattenFiles(entries: ReaddirEntry[] | undefined): ReaddirEntry[] {
  if (!entries) return [];
  const out: ReaddirEntry[] = [];
  for (const entry of entries) {
    if (entry.isDir) out.push(...flattenFiles(entry.children));
    else out.push(entry);
  }
  return out;
}

/**
 * Scans `<workingDir>/output` for media files and registers any not already
 * known. Tool output text-scanning (extractAndSaveFiles below) can't reliably
 * recover a correct path when a command `cd`s into a subdirectory before
 * writing relative filenames (e.g. yt-dlp's `Destination: <file>.mp3` line) —
 * the real filesystem, read the same way the Workspace panel already reads
 * it, is the only reliable source of truth for those.
 */
async function scanOutputDirectory(taskId: string, workingDir: string) {
  try {
    const known = new Set((await getFilesByTaskId(taskId)).map((f) => f.path));
    const res = await fetch(`${API_BASE_URL}/files/readdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `${workingDir.replace(/\/+$/, '')}/output`,
        maxDepth: 5,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      success: boolean;
      files?: ReaddirEntry[];
    };
    if (!data.success) return;

    for (const entry of flattenFiles(data.files)) {
      if (known.has(entry.path)) continue;
      const type = getFileTypeFromPath(entry.path);
      if (!SCANNABLE_TYPES.has(type)) continue;
      await createFile({
        task_id: taskId,
        name: entry.name,
        type,
        path: entry.path,
      });
    }
  } catch {
    // Non-critical — inline preview is best-effort, chat text still stands.
  }
}

/**
 * Registers files created by tools (Bash, Skill, WebFetch, etc.) into the
 * Library `files` table so they render inline via LocalOutputArtifactPreviews
 * and show up in useV2Artifacts(). The legacy `useAgent.ts` did this for every
 * tool result; the V2 route's CopilotKit agent stream has no equivalent, so
 * without this, only Write/Edit-produced files that separately match a path
 * pattern ever get registered — everything else (e.g. yt-dlp downloads run
 * via Bash) stays invisible in chat even though it's on disk.
 */
export function useV2FileExtraction(
  taskId: string | undefined,
  messages: AGUIMessage[],
  workingDir: string | undefined,
  isRunning: boolean,
) {
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!taskId) return;
    const currentTaskId = taskId;

    let cancelled = false;

    async function run() {
      let didWork = false;
      for (const msg of messages) {
        if (msg.role !== 'tool' || !msg.toolCallId) continue;
        if (processedRef.current.has(msg.toolCallId)) continue;

        const toolCallMsg = messages.find(
          (m) =>
            m.role === 'assistant' &&
            m.toolCalls?.some((tc) => tc.id === msg.toolCallId),
        );
        const toolCall = toolCallMsg?.toolCalls?.find(
          (tc) => tc.id === msg.toolCallId,
        );
        if (!toolCall) continue;

        processedRef.current.add(msg.toolCallId);
        await extractAndSaveFiles(
          currentTaskId,
          getToolName(toolCall),
          getToolArgs(toolCall),
          msg.content,
          workingDir,
        );
        didWork = true;
      }
      if (didWork && !cancelled) {
        window.dispatchEvent(new CustomEvent('task-files-updated'));
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [taskId, messages, workingDir]);

  // Directory scan when idle — catches files text-scanning can't reliably
  // locate (relative paths written after a `cd` into a subdir). Runs once
  // per task on mount (covers reopening an already-finished task) and again
  // whenever a run transitions from running to idle.
  const scanStateRef = useRef<{ taskId?: string; wasRunning: boolean }>({
    wasRunning: isRunning,
  });
  useEffect(() => {
    if (!taskId || !workingDir || isRunning) {
      scanStateRef.current.wasRunning = isRunning;
      return;
    }
    const state = scanStateRef.current;
    const isNewTask = state.taskId !== taskId;
    const justFinished = state.wasRunning && !isRunning;
    state.taskId = taskId;
    state.wasRunning = isRunning;
    if (!isNewTask && !justFinished) return;

    void scanOutputDirectory(taskId, workingDir).then(() => {
      window.dispatchEvent(new CustomEvent('task-files-updated'));
    });
  }, [isRunning, taskId, workingDir]);
}
