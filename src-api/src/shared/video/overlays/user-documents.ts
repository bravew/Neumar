import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  compileOverlayDocument,
  OverlayCompileError,
  type OverlayLintIssue,
} from '@neumar/video-ir';
import { z } from 'zod';

import { createLogger } from '@/shared/utils/logger';

import { getVideoWorkspaceRoot } from '../store';

const logger = createLogger('VideoUserOverlayDocuments');

export const USER_OVERLAY_DOCUMENT_FILE = 'user-overlay-documents.json';
export const USER_OVERLAY_DOCUMENT_SCHEMA_ID =
  'neuma.video.user-overlay-documents.v1';

const OverlayLintIssueSchema = z
  .object({
    rule: z.string().min(1),
    severity: z.enum(['error', 'warning']),
    message: z.string().min(1),
  })
  .strict();

const UserOverlayDocumentControlSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum(['number', 'color', 'text', 'select', 'toggle']),
    label: z.string().min(1).max(120),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().optional(),
    options: z.array(z.string().min(1).max(80)).max(40).optional(),
  })
  .strict();

const UserOverlayDocumentProvenanceSchema = z
  .object({
    kind: z.enum(['agent', 'video-to-template']),
    sourceId: z.string().min(1).optional(),
    createdAt: z.string().min(1),
  })
  .strict();

export const UserOverlayDocumentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    sourceHtml: z.string().min(1).max(200_000),
    compiledHtml: z.string().min(1).max(400_000),
    controls: z.array(UserOverlayDocumentControlSchema).max(40).optional(),
    tags: z.array(z.string().min(1).max(40)).max(24).optional(),
    lintIssues: z.array(OverlayLintIssueSchema),
    provenance: UserOverlayDocumentProvenanceSchema,
  })
  .strict();

export const UserOverlayDocumentFileSchema = z
  .object({
    schema: z.literal(USER_OVERLAY_DOCUMENT_SCHEMA_ID),
    documents: z.array(UserOverlayDocumentSchema),
  })
  .strict();

export const SaveUserOverlayDocumentInputSchema = z
  .object({
    name: z.string().min(1).max(80),
    html: z.string().min(1).max(200_000),
    controls: z.array(UserOverlayDocumentControlSchema).max(40).optional(),
    tags: z.array(z.string().min(1).max(40)).max(24).optional(),
    provenance: z
      .object({
        kind: z.enum(['agent', 'video-to-template']),
        sourceId: z.string().min(1).optional(),
      })
      .strict(),
    userConfirmed: z.literal(true),
  })
  .strict();

export type UserOverlayDocument = z.infer<typeof UserOverlayDocumentSchema>;
export type SaveUserOverlayDocumentInput = z.infer<
  typeof SaveUserOverlayDocumentInputSchema
>;

function storePath(): string {
  return path.join(getVideoWorkspaceRoot(), USER_OVERLAY_DOCUMENT_FILE);
}

export async function listUserOverlayDocuments(): Promise<
  UserOverlayDocument[]
> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = UserOverlayDocumentFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn('video.user_overlay_documents.invalid_store_file', {
        path: storePath(),
      });
      return [];
    }
    return parsed.data.documents;
  } catch {
    return [];
  }
}

export async function saveUserOverlayDocument(
  input: SaveUserOverlayDocumentInput,
): Promise<UserOverlayDocument> {
  const parsed = SaveUserOverlayDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new UserOverlayDocumentError(
      'Invalid overlay document input',
      'invalid_input',
    );
  }
  let compiled: ReturnType<typeof compileOverlayDocument>;
  try {
    compiled = compileOverlayDocument(parsed.data.html);
  } catch (error) {
    if (error instanceof OverlayCompileError) {
      throw new UserOverlayDocumentError(
        'Overlay document failed lint',
        'lint_failed',
        error.issues,
      );
    }
    throw error;
  }
  if (compiled.html.length > 400_000) {
    throw new UserOverlayDocumentError(
      'Compiled overlay document is too large',
      'compiled_too_large',
    );
  }
  const tags = normalizeTags(parsed.data.tags);
  const name = parsed.data.name.trim().slice(0, 80) || 'Custom overlay';
  const document: UserOverlayDocument = {
    id: `doc:${randomUUID()}`,
    name,
    sourceHtml: parsed.data.html,
    compiledHtml: compiled.html,
    ...(parsed.data.controls ? { controls: parsed.data.controls } : {}),
    ...(tags ? { tags } : {}),
    lintIssues: compiled.issues,
    provenance: {
      kind: parsed.data.provenance.kind,
      ...(parsed.data.provenance.sourceId
        ? { sourceId: parsed.data.provenance.sourceId }
        : {}),
      createdAt: new Date().toISOString(),
    },
  };
  const documents = await listUserOverlayDocuments();
  await writeStore([...documents, document]);
  logger.info('video.user_overlay_documents.saved', {
    document_id: document.id,
    provenance_kind: document.provenance.kind,
  });
  return document;
}

export async function deleteUserOverlayDocument(id: string): Promise<boolean> {
  const documents = await listUserOverlayDocuments();
  const remaining = documents.filter((document) => document.id !== id);
  if (remaining.length === documents.length) return false;
  await writeStore(remaining);
  logger.info('video.user_overlay_documents.deleted', { document_id: id });
  return true;
}

async function writeStore(documents: UserOverlayDocument[]): Promise<void> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(
    storePath(),
    JSON.stringify(
      { schema: USER_OVERLAY_DOCUMENT_SCHEMA_ID, documents },
      null,
      2,
    ),
    'utf8',
  );
}

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const normalized = [
    ...new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
  ].slice(0, 24);
  return normalized.length > 0 ? normalized : undefined;
}

export class UserOverlayDocumentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly issues: OverlayLintIssue[] = [],
  ) {
    super(message);
    this.name = 'UserOverlayDocumentError';
  }
}
