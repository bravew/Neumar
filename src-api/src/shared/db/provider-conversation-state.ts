import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';

import { getDatabase } from './index';

const ProviderWireMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool', 'developer']),
  })
  .loose();
const ProviderWireMessagesSchema = z.array(ProviderWireMessageSchema);

export interface ProviderConversationIdentity {
  taskId: string;
  providerId: string;
  modelId: string;
  workspaceRoot: string;
}

export interface ProviderConversationState extends ProviderConversationIdentity {
  schemaVersion: 1;
  messages: ChatCompletionMessageParam[];
  estimatedTokens: number;
  createdAt: string;
  updatedAt: string;
}

interface ProviderConversationStateRow {
  task_id: string;
  provider_id: string;
  model_id: string;
  workspace_root: string;
  schema_version: number;
  messages_json: string;
  estimated_tokens: number;
  created_at: string;
  updated_at: string;
}

export function estimateProviderStateTokens(
  messages: readonly ChatCompletionMessageParam[],
): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

export function getProviderConversationState(
  identity: ProviderConversationIdentity,
): ProviderConversationState | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM provider_conversation_state WHERE task_id = ?')
    .get(identity.taskId) as ProviderConversationStateRow | undefined;
  if (!row) return null;
  if (
    row.provider_id !== identity.providerId ||
    row.model_id !== identity.modelId ||
    row.workspace_root !== identity.workspaceRoot ||
    row.schema_version !== 1
  ) {
    db.prepare('DELETE FROM provider_conversation_state WHERE task_id = ?').run(
      identity.taskId,
    );
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.messages_json) as unknown;
  } catch {
    decoded = null;
  }
  const parsed = ProviderWireMessagesSchema.safeParse(decoded);
  if (!parsed.success) {
    db.prepare('DELETE FROM provider_conversation_state WHERE task_id = ?').run(
      identity.taskId,
    );
    return null;
  }
  return {
    ...identity,
    schemaVersion: 1,
    messages: parsed.data as ChatCompletionMessageParam[],
    estimatedTokens: row.estimated_tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertProviderConversationState(
  identity: ProviderConversationIdentity,
  messages: readonly ChatCompletionMessageParam[],
): void {
  const now = new Date().toISOString();
  const messagesJson = JSON.stringify(messages);
  getDatabase()
    .prepare(
      `INSERT INTO provider_conversation_state
         (task_id, provider_id, model_id, workspace_root, schema_version,
          messages_json, estimated_tokens, created_at, updated_at)
       VALUES (@taskId, @providerId, @modelId, @workspaceRoot, 1,
          @messagesJson, @estimatedTokens, @now, @now)
       ON CONFLICT(task_id) DO UPDATE SET
         provider_id = excluded.provider_id,
         model_id = excluded.model_id,
         workspace_root = excluded.workspace_root,
         schema_version = excluded.schema_version,
         messages_json = excluded.messages_json,
         estimated_tokens = excluded.estimated_tokens,
         updated_at = excluded.updated_at`,
    )
    .run({
      ...identity,
      messagesJson,
      estimatedTokens: estimateProviderStateTokens(messages),
      now,
    });
}

export function deleteProviderConversationState(taskId: string): void {
  getDatabase()
    .prepare('DELETE FROM provider_conversation_state WHERE task_id = ?')
    .run(taskId);
}
