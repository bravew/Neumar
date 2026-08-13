import { getFilesByTaskId } from '@/shared/db/operations';
import type { AgentRunRow } from '@/shared/db/operations';
import type { FileType, LibraryFile } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AgentRuntime');

export interface ReattachRunContext {
  runId: string;
  startedAtMs: number;
  scanOutputArtifacts?: () => Promise<number | void>;
  recordRestoredArtifact?: (filePath: string) => void;
}

export interface AGUITaskFile {
  id: string;
  taskId: string;
  name: string;
  path: string;
  kind:
    | 'image'
    | 'video'
    | 'audio'
    | 'pdf'
    | 'html'
    | 'doc'
    | 'code'
    | 'text'
    | 'presentation'
    | 'spreadsheet'
    | 'other';
  createdAt: string;
  runId?: string;
  sourceToolCallId?: string;
  role?: 'input' | 'output';
  preview: string | null;
  thumbnail: string | null;
  provenance: string | null;
}

const RUN_WINDOW_SLOP_MS = 1_000;

export function canReconcilePendingDelivery(
  run: Pick<AgentRunRow, 'delivery' | 'delivery_reconciliation_deadline'>,
  nowMs = Date.now(),
): boolean {
  if (run.delivery !== 'pending' || !run.delivery_reconciliation_deadline) {
    return false;
  }
  const deadline = Date.parse(run.delivery_reconciliation_deadline);
  return Number.isFinite(deadline) && deadline > nowMs;
}

export function fileTypeToTaskFileKind(type: FileType): AGUITaskFile['kind'] {
  switch (type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'code':
    case 'text':
    case 'presentation':
    case 'spreadsheet':
      return type;
    case 'website':
      return 'html';
    case 'document':
      return 'doc';
    default:
      return 'other';
  }
}

export function inferRunIdFromOutputPath(
  filePath: string | undefined,
): string | undefined {
  return filePath?.match(/[\\/]output[\\/]([^\\/]+)[\\/]/i)?.[1];
}

export function isPromotedInputPath(filePath: string | undefined): boolean {
  return /[\\/]output[\\/][^\\/]+[\\/]inputs[\\/]/i.test(filePath ?? '');
}

function parseCreatedAtMs(createdAt: string): number | null {
  const normalized = createdAt.includes('T')
    ? createdAt
    : `${createdAt.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinRunWindow(
  file: LibraryFile,
  context: ReattachRunContext | undefined,
): boolean {
  if (!context) return false;
  const createdAtMs = parseCreatedAtMs(file.created_at);
  return (
    createdAtMs !== null &&
    createdAtMs >= context.startedAtMs - RUN_WINDOW_SLOP_MS
  );
}

export function dbFileToAGUITaskFile(
  file: LibraryFile,
  context?: ReattachRunContext,
): AGUITaskFile {
  const inferredRunId = inferRunIdFromOutputPath(file.path);
  const isInput = isPromotedInputPath(file.path);
  const activeRunFile = isWithinRunWindow(file, context);
  const runId =
    inferredRunId ?? (activeRunFile && context ? context.runId : undefined);
  const role: AGUITaskFile['role'] = isInput
    ? 'input'
    : activeRunFile
      ? 'output'
      : undefined;

  return {
    id: String(file.id),
    taskId: file.task_id,
    name: file.name,
    path: file.path,
    kind: fileTypeToTaskFileKind(file.type),
    createdAt: file.created_at,
    runId,
    role,
    preview: file.preview,
    thumbnail: file.thumbnail,
    provenance: file.provenance ?? null,
  };
}

export async function restoreReattachFiles(
  taskId: string,
  context?: ReattachRunContext,
): Promise<{ files: AGUITaskFile[]; restoredFiles: number }> {
  const scannedFiles = context?.scanOutputArtifacts
    ? ((await context.scanOutputArtifacts()) ?? 0)
    : 0;
  const files = getFilesByTaskId(taskId).map((file) =>
    dbFileToAGUITaskFile(file, context),
  );
  const restoredFiles = context
    ? files.filter(
        (file) => file.runId === context.runId && file.role === 'output',
      ).length
    : 0;

  if (context?.recordRestoredArtifact) {
    for (const file of files) {
      if (file.runId === context.runId && file.role === 'output') {
        context.recordRestoredArtifact(file.path);
      }
    }
  }

  if (context) {
    logger.info('reattach_produced_files', {
      taskId,
      runId: context.runId,
      restoredFiles,
      scannedFiles,
    });
  }

  return { files, restoredFiles };
}
