/**
 * The "where should this batch go?" question and the grant that answers it.
 *
 * The question is an ordinary agent question, so it uses the existing interrupt
 * card, resume validation and cancellation. The grant row is what makes the
 * answer meaningful: it binds the batch to one folder and one identity, and it
 * can be claimed once, so a duplicate or concurrent resume starts nothing.
 */

import {
  downloadMediaInputSchema,
  type DownloadMediaInput,
  type DownloadMediaOperation,
} from '@neumar/video-ir';

import {
  agentQuestionService,
  serializeAgentQuestion,
  type SerializedAgentQuestion,
} from '@/core/agent/questions';

import { getDatabase } from '@/shared/db/index';

import {
  bindDestination,
  destinationOptions,
  destinationPolicy,
  DestinationDenied,
  type DestinationGrant,
} from './destination';

/** The question text, fixed so the stored record and the transcript agree. */
export const DOWNLOAD_DESTINATION_QUESTION =
  'Where should the videos be saved?';
export const DOWNLOAD_DESTINATION_ID = 'download-destination';
/** The option that opens the folder picker; it is never a path itself. */
export const DOWNLOAD_OTHER_FOLDER_OPTION = 'Choose another folder…';

const folderLabels: Record<string, { task: string; other: string }> = {
  en: { task: 'Task folder', other: 'Another folder' },
  zh: { task: '任务文件夹', other: '其他文件夹' },
  es: { task: 'Carpeta de la tarea', other: 'Otra carpeta' },
  fr: { task: 'Dossier de la tâche', other: 'Un autre dossier' },
  hi: { task: 'कार्य फ़ोल्डर', other: 'दूसरा फ़ोल्डर' },
  pt: { task: 'Pasta da tarefa', other: 'Outra pasta' },
};

function folderLabel(
  path: string,
  kind: 'task' | 'permitted',
  language?: string,
) {
  const labels = folderLabels[language ?? 'en'] ?? folderLabels.en!;
  return kind === 'task' ? labels.task : path;
}

export interface DestinationRequest {
  grantId: string;
  questionId: string;
  question: SerializedAgentQuestion;
}

interface GrantRow {
  id: string;
  task_id: string;
  run_id: string;
  tool_call_id: string;
  batch_id: string;
  question_id: string | null;
  directory: string;
  device: string;
  inode: string;
  options_json: string;
  input_json: string;
  started: number;
}

interface OfferedFolder {
  label: string;
  path: string;
  kind: 'task' | 'permitted';
}

export interface DownloadRequestScope {
  taskId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  batchId: string;
}

function destinationQuestion(offered: OfferedFolder[]) {
  // The card requires two to four options, and the task folder alone is not
  // enough. The picker option is a control, not a destination: an answer that
  // still names it is refused.
  return {
    id: DOWNLOAD_DESTINATION_ID,
    question: DOWNLOAD_DESTINATION_QUESTION,
    header: 'Save videos',
    multiSelect: false,
    options: [
      ...offered.map((folder) => ({
        label: folder.label,
        description: folder.path,
      })),
      {
        label: DOWNLOAD_OTHER_FOLDER_OPTION,
        description: 'Pick any folder you have allowed.',
      },
    ],
  };
}

/**
 * Record the batch and ask where it should go. Returns the receipt the model
 * sees. The question is stored before the grant so the grant can name it.
 */
export function requestDownloadDestination(
  scope: DownloadRequestScope,
  rawInput: unknown,
  language?: string,
): DestinationRequest {
  const input: DownloadMediaInput = downloadMediaInputSchema.parse(rawInput);
  const policy = destinationPolicy(scope.taskId);
  const offered: OfferedFolder[] = destinationOptions(policy).map((option) => ({
    label: folderLabel(option.path, option.kind, language),
    path: option.path,
    kind: option.kind,
  }));
  const questions = [destinationQuestion(offered)];

  const question = agentQuestionService.createPendingQuestion({
    sessionId: scope.sessionId,
    taskId: scope.taskId,
    questions,
  });

  const grantId = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO download_destination_grants
         (id, task_id, run_id, tool_call_id, batch_id, question_id,
          directory, device, inode, options_json, input_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?)`,
    )
    .run(
      grantId,
      scope.taskId,
      scope.runId,
      scope.toolCallId,
      scope.batchId,
      question.id,
      JSON.stringify(offered),
      JSON.stringify(input),
      Date.now(),
    );

  return {
    grantId,
    questionId: question.id,
    question: { ...serializeAgentQuestion(question), questions },
  };
}

function grantByQuestion(
  taskId: string,
  questionId: string,
): GrantRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT * FROM download_destination_grants
       WHERE task_id = ? AND question_id = ?`,
    )
    .get(taskId, questionId) as GrantRow | undefined;
}

function offeredFolders(row: GrantRow): OfferedFolder[] {
  try {
    const parsed: unknown = JSON.parse(row.options_json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (folder): folder is OfferedFolder =>
        typeof folder === 'object' &&
        folder !== null &&
        typeof (folder as OfferedFolder).label === 'string' &&
        typeof (folder as OfferedFolder).path === 'string' &&
        ((folder as OfferedFolder).kind === 'task' ||
          (folder as OfferedFolder).kind === 'permitted'),
    );
  } catch {
    return [];
  }
}

/**
 * The folder an answer chose, or a refusal. An offered label resolves to its
 * folder; anything else is treated as a folder path the picker returned and is
 * checked against the task's current policy.
 */
function chosenFolder(row: GrantRow, answer: string): string {
  const label = answer.trim();
  if (!label || label === DOWNLOAD_OTHER_FOLDER_OPTION) {
    throw new DestinationDenied('Choose a folder to save to.');
  }
  const offered = offeredFolders(row).find((folder) => folder.label === label);
  if (offered) return offered.path;
  return label;
}

export interface ClaimedDestination {
  grant: DestinationGrant;
  operation: DownloadMediaOperation;
}

export type DestinationClaim =
  | { ok: true; value: ClaimedDestination }
  | { ok: false; reason: 'denied' | 'started'; message: string };

/**
 * Claim the grant for the continuation that is about to start.
 *
 * The question must still be open and must belong to this task; the folder is
 * re-checked against the current policy; and the claim is one atomic update,
 * so a repeated resume or a concurrent request cannot start a second batch.
 */
export function claimDownloadDestination(
  taskId: string,
  questionId: string,
  answer: string,
  runId: string,
): DestinationClaim {
  const row = grantByQuestion(taskId, questionId);
  if (!row) {
    return {
      ok: false,
      reason: 'denied',
      message: 'This download request is no longer available.',
    };
  }
  if (row.started === 1) {
    return {
      ok: false,
      reason: 'started',
      message: 'This download already started.',
    };
  }

  let grant: DestinationGrant;
  try {
    grant = bindDestination(
      destinationPolicy(taskId),
      chosenFolder(row, answer),
    );
  } catch (error) {
    return {
      ok: false,
      reason: 'denied',
      message:
        error instanceof DestinationDenied
          ? error.message
          : 'This download folder is unavailable or not permitted.',
    };
  }

  let input: DownloadMediaInput;
  try {
    input = downloadMediaInputSchema.parse(JSON.parse(row.input_json));
  } catch {
    return {
      ok: false,
      reason: 'denied',
      message: 'This download request is invalid.',
    };
  }

  const claimed = getDatabase()
    .prepare(
      `UPDATE download_destination_grants
         SET started = 1, directory = ?, device = ?, inode = ?
       WHERE id = ? AND started = 0`,
    )
    .run(grant.directory, grant.device, grant.inode, row.id).changes;
  if (claimed !== 1) {
    return {
      ok: false,
      reason: 'started',
      message: 'This download already started.',
    };
  }

  return {
    ok: true,
    value: {
      grant,
      operation: {
        version: 1,
        taskId: row.task_id,
        // The card is addressed by batch and tool call; the continuation's run
        // is the one that reports progress.
        runId,
        toolCallId: row.tool_call_id,
        batchId: row.batch_id,
        destinationGrantId: row.id,
        input,
      },
    },
  };
}

/** The grant a continuation starts from, when the route already resolved it. */
export function findGrantByQuestion(
  taskId: string,
  questionId: string,
): GrantRow | undefined {
  return grantByQuestion(taskId, questionId);
}

/** Drop a request whose question was cancelled, so it can never be claimed. */
export function cancelDownloadDestinationRequest(
  taskId: string,
  questionId: string,
): void {
  getDatabase()
    .prepare(
      `DELETE FROM download_destination_grants
       WHERE task_id = ? AND question_id = ? AND started = 0`,
    )
    .run(taskId, questionId);
}
