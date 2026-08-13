import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { type ContentGraph, ContentGraphSchema } from '@neumar/video-ir';

import { createLogger } from '@/shared/utils/logger';
import {
  getVideoProjectDirForRoot,
  getVideoProjectRoot,
} from '@/shared/video/store';

// Phase 2 M3 persistence helpers.
//
// Layout under each video project's dir:
//
//   <workDir>/.neuma/video/<projectId>/
//   ├── content-graph.json      — Zod-validated ContentGraph
//   ├── selected-template.txt   — single line: chosen template id
//   └── frames/<nodeId>.html    — optional per-frame HTML overrides
//
// Every nodeId / templateId passes the same slug-safe guard the
// materializer uses (Slice B bot review). All writes stay inside the
// per-project dir.
//
// See dev-doc/html-video/06-06/05-slice-D-agent-write-tools.md.

const logger = createLogger('VideoContentGraphPersistence');

const SLUG_SEGMENT_RE = /^[\w][\w.-]*$/;

const CONTENT_GRAPH_FILE = 'content-graph.json';
const SELECTED_TEMPLATE_FILE = 'selected-template.txt';
const TEMPLATE_VARIABLES_FILE = 'template-variables.json';
const FRAMES_DIR = 'frames';

export class ContentGraphPersistenceError extends Error {
  constructor(
    public readonly code:
      | 'unsafe-segment'
      | 'graph-validation-failed'
      | 'unknown-node-id',
    message: string,
  ) {
    super(message);
    this.name = 'ContentGraphPersistenceError';
  }
}

function assertSlugSafe(segment: string, kind: string): void {
  if (!SLUG_SEGMENT_RE.test(segment) || segment === '.' || segment === '..') {
    throw new ContentGraphPersistenceError(
      'unsafe-segment',
      `${kind} "${segment}" is not slug-safe (^[\\w][\\w.-]*$)`,
    );
  }
}

function projectDir(projectId: string): string {
  assertSlugSafe(projectId, 'projectId');
  return getVideoProjectDirForRoot(getVideoProjectRoot(projectId), projectId);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Persist + Zod-validate the content-graph. Atomic write via tmp + rename. */
export async function writeContentGraph(
  projectId: string,
  graph: ContentGraph,
): Promise<void> {
  const parsed = ContentGraphSchema.safeParse(graph);
  if (!parsed.success) {
    throw new ContentGraphPersistenceError(
      'graph-validation-failed',
      `ContentGraph validation failed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const dir = projectDir(projectId);
  await ensureDir(dir);
  const filePath = path.join(dir, CONTENT_GRAPH_FILE);
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  await fs.writeFile(tmpPath, JSON.stringify(parsed.data, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
  logger.info(`Wrote content-graph for project ${projectId}`);
}

/** Read + Zod-validate. Returns null if the file does not exist. */
export async function readContentGraph(
  projectId: string,
): Promise<ContentGraph | null> {
  const filePath = path.join(projectDir(projectId), CONTENT_GRAPH_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed = ContentGraphSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ContentGraphPersistenceError(
      'graph-validation-failed',
      `Persisted content-graph for project ${projectId} failed validation: ${parsed.error.issues
        .map((i) => i.message)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

/** Persist a per-frame HTML override. Validates nodeId against the current graph. */
export async function writeFrameHtml(
  projectId: string,
  nodeId: string,
  html: string,
): Promise<void> {
  assertSlugSafe(nodeId, 'nodeId');
  const graph = await readContentGraph(projectId);
  if (graph && !graph.nodes.some((n) => n.id === nodeId)) {
    throw new ContentGraphPersistenceError(
      'unknown-node-id',
      `writeFrameHtml: nodeId "${nodeId}" is not in the persisted content-graph`,
    );
  }
  const dir = path.join(projectDir(projectId), FRAMES_DIR);
  await ensureDir(dir);
  const filePath = path.join(dir, `${nodeId}.html`);
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  await fs.writeFile(tmpPath, html, 'utf8');
  await fs.rename(tmpPath, filePath);
  logger.info(`Wrote frame override ${nodeId} for project ${projectId}`);
}

/** Read a per-frame HTML override. Returns null if none exists. */
export async function readFrameHtml(
  projectId: string,
  nodeId: string,
): Promise<string | null> {
  assertSlugSafe(nodeId, 'nodeId');
  const filePath = path.join(
    projectDir(projectId),
    FRAMES_DIR,
    `${nodeId}.html`,
  );
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Remove overrides whose nodeIds are no longer in the current graph. */
export async function pruneStaleFrameOverrides(
  projectId: string,
  graph: ContentGraph,
): Promise<string[]> {
  const dir = path.join(projectDir(projectId), FRAMES_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const liveNodeIds = new Set(graph.nodes.map((n) => n.id));
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.html')) continue;
    const nodeId = entry.slice(0, -'.html'.length);
    if (!liveNodeIds.has(nodeId)) {
      await fs.unlink(path.join(dir, entry));
      removed.push(nodeId);
    }
  }
  return removed;
}

/** Persist the selected template id. */
export async function selectTemplate(
  projectId: string,
  templateId: string,
): Promise<void> {
  assertSlugSafe(templateId, 'templateId');
  const dir = projectDir(projectId);
  await ensureDir(dir);
  const filePath = path.join(dir, SELECTED_TEMPLATE_FILE);
  await fs.writeFile(filePath, `${templateId}\n`, 'utf8');
  logger.info(`Selected template ${templateId} for project ${projectId}`);
}

export async function readSelectedTemplate(
  projectId: string,
): Promise<string | null> {
  const filePath = path.join(projectDir(projectId), SELECTED_TEMPLATE_FILE);
  try {
    return (await fs.readFile(filePath, 'utf8')).trim() || null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Persist the UI-authored template variable values for a project. */
export async function writeTemplateVariables(
  projectId: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const dir = projectDir(projectId);
  await ensureDir(dir);
  const filePath = path.join(dir, TEMPLATE_VARIABLES_FILE);
  const tmpPath = `${filePath}.tmp-${randomUUID()}`;
  await fs.writeFile(tmpPath, JSON.stringify(variables, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

/** Read the persisted template variable values. Returns null when unset. */
export async function readTemplateVariables(
  projectId: string,
): Promise<Record<string, unknown> | null> {
  const filePath = path.join(projectDir(projectId), TEMPLATE_VARIABLES_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
