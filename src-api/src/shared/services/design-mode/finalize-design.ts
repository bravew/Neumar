import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getCraft, getDesignSystem } from './catalogs';
import {
  appendProjectHistory,
  getProjectDir,
  listProjectFiles,
  readProjectTextFile,
  resolveProjectPath,
  writeTextAtomic,
} from './fs';
import { getDesignProject } from './projects';
import type { DesignFileEntry, DesignProject } from './types';

const DESIGN_MD = 'DESIGN.md';
const FINALIZE_LOCK = '.finalize.lock';

export type DesignMdStaleReason =
  | 'files-newer'
  | 'conversation-newer'
  | 'unknown-provenance'
  | null;

export interface DesignMdState {
  exists: boolean;
  generatedAt: string | null;
  transcriptMessageCount: number | null;
  designSystemId: string | null;
  currentArtifact: string | null;
  isStale: boolean;
  staleReason: DesignMdStaleReason;
}

export interface FinalizeDesignResult {
  path: string;
  generatedAt: string;
  runId: string;
  state: DesignMdState;
}

export class FinalizeDesignLockedError extends Error {
  constructor(readonly holderRunId: string | null) {
    super(
      holderRunId
        ? `Design finalization is already running (${holderRunId})`
        : 'Design finalization is already running',
    );
    this.name = 'FinalizeDesignLockedError';
  }
}

interface DesignMdProvenance {
  projectId: string;
  generatedAt: string;
  designSystemId: string | null;
  currentArtifact: string | null;
  transcriptMessageCount: number;
  model: string;
  generator: 'neuma-design-mode';
  runId: string;
}

export async function finalizeDesignProject(
  projectId: string,
): Promise<FinalizeDesignResult> {
  const runId = `finalize_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const lockPath = path.join(getProjectDir(projectId), FINALIZE_LOCK);
  const lock = await acquireFinalizeLock(lockPath, runId);
  try {
    const project = await getDesignProject(projectId);
    const files = flattenFiles(await listProjectFiles(projectId));
    const generatedAt = new Date().toISOString();
    const currentArtifact = pickCurrentArtifact(project, files);
    const designSystem = project.designSystemId
      ? await getDesignSystem(project.designSystemId)
      : null;
    const crafts = (
      await Promise.all(project.craftRefs.map((id) => getCraft(id)))
    ).flatMap((item) => (item ? [item] : []));
    const history = await readProjectHistory(projectId);
    const historyTail = history.slice(-40);
    const provenance: DesignMdProvenance = {
      projectId,
      generatedAt,
      designSystemId: project.designSystemId,
      currentArtifact,
      transcriptMessageCount: countRelevantHistoryEvents(history),
      model: project.media?.model ?? 'neuma-design-mode-local-synthesis',
      generator: 'neuma-design-mode',
      runId,
    };
    const markdown = renderDesignMd({
      project,
      files,
      designSystemBody: designSystem?.body ?? null,
      craftTitles: crafts.map((craft) => craft.title),
      history: historyTail,
      provenance,
    });

    await writeTextAtomic(
      resolveProjectPath(projectId, DESIGN_MD).absolutePath,
      markdown,
    );
    await appendProjectHistory(projectId, {
      type: 'design.finalized',
      at: generatedAt,
      runId,
      path: DESIGN_MD,
      currentArtifact,
      model: provenance.model,
      bytes: Buffer.byteLength(markdown, 'utf-8'),
      transcriptMessageCount: provenance.transcriptMessageCount,
    });
    return {
      path: DESIGN_MD,
      generatedAt,
      runId,
      state: await getDesignMdState(projectId),
    };
  } finally {
    await releaseFinalizeLock(lock);
  }
}

export async function getDesignMdState(
  projectId: string,
): Promise<DesignMdState> {
  const files = flattenFiles(await listProjectFiles(projectId));
  const designMd = files.find((file) => !file.isDir && file.path === DESIGN_MD);
  if (!designMd) return emptyDesignMdState();

  let provenance: DesignMdProvenance | null = null;
  try {
    const file = await readProjectTextFile(projectId, DESIGN_MD);
    provenance = parseDesignMdProvenance(file.content);
  } catch {
    provenance = null;
  }

  if (!provenance?.generatedAt) {
    return {
      exists: true,
      generatedAt: null,
      transcriptMessageCount: null,
      designSystemId: null,
      currentArtifact: null,
      isStale: true,
      staleReason: 'unknown-provenance',
    };
  }

  const generatedMs = Date.parse(provenance.generatedAt);
  const historyCount = countRelevantHistoryEvents(
    await readProjectHistory(projectId),
  );
  const newestFileMs = files.reduce((max, file) => {
    if (
      file.isDir ||
      file.path === DESIGN_MD ||
      file.path === 'history.jsonl' ||
      file.path.startsWith('exports/') ||
      file.path.startsWith('provenance/') ||
      !file.updatedAt
    ) {
      return max;
    }
    return Math.max(max, Date.parse(file.updatedAt) || 0);
  }, 0);
  const filesNewer = Number.isFinite(generatedMs) && newestFileMs > generatedMs;
  const conversationNewer = historyCount > provenance.transcriptMessageCount;
  return {
    exists: true,
    generatedAt: provenance.generatedAt,
    transcriptMessageCount: provenance.transcriptMessageCount,
    designSystemId: provenance.designSystemId,
    currentArtifact: provenance.currentArtifact,
    isStale: !Number.isFinite(generatedMs) || filesNewer || conversationNewer,
    staleReason: !Number.isFinite(generatedMs)
      ? 'unknown-provenance'
      : filesNewer
        ? 'files-newer'
        : conversationNewer
          ? 'conversation-newer'
          : null,
  };
}

function renderDesignMd({
  project,
  files,
  designSystemBody,
  craftTitles,
  history,
  provenance,
}: {
  project: DesignProject;
  files: DesignFileEntry[];
  designSystemBody: string | null;
  craftTitles: string[];
  history: unknown[];
  provenance: DesignMdProvenance;
}) {
  const artifactFiles = files
    .filter((file) => !file.isDir)
    .map((file) => file.path)
    .sort();
  const brief = JSON.stringify(project.brief ?? {}, null, 2);
  return [
    '# DESIGN.md',
    '',
    '## Summary',
    `Project "${project.title}" is a ${project.surface} DesignMode project. Treat this file as the durable design intent handoff for future CLI or agent work.`,
    '',
    '## Brand And Voice',
    designSystemBody
      ? summarizeMarkdown(designSystemBody)
      : 'No active design system was selected when this specification was generated.',
    '',
    '## Information Architecture',
    brief.trim()
      ? `Project brief:\n\n\`\`\`json\n${brief}\n\`\`\``
      : 'No structured brief is recorded yet.',
    '',
    '## Components And Patterns',
    craftTitles.length > 0
      ? craftTitles.map((title) => `- ${title}`).join('\n')
      : 'No extra craft references are pinned.',
    '',
    '## Visual System',
    [
      `Surface: ${project.surface}`,
      `Design system: ${project.designSystemId ?? 'none'}`,
      `Inspirations: ${project.inspirationDesignSystemIds.join(', ') || 'none'}`,
    ].join('\n'),
    '',
    '## Files And Artifacts',
    artifactFiles.length > 0
      ? artifactFiles.map((file) => `- ${file}`).join('\n')
      : 'No project files are present.',
    '',
    '## Open Questions',
    '- Confirm final copy, accessibility review, and export target before production handoff.',
    '',
    '## Recent Project History',
    history.length > 0
      ? history.map((event) => `- ${historyLine(event)}`).join('\n')
      : 'No history events were available.',
    '',
    '## Provenance',
    '',
    '```json',
    JSON.stringify(provenance, null, 2),
    '```',
    '',
  ].join('\n');
}

function parseDesignMdProvenance(content: string): DesignMdProvenance | null {
  const match = content.match(/## Provenance\s+```json\s+([\s\S]*?)\s+```/i);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<DesignMdProvenance>;
    if (typeof parsed.generatedAt !== 'string') return null;
    return {
      projectId: String(parsed.projectId ?? ''),
      generatedAt: parsed.generatedAt,
      designSystemId:
        typeof parsed.designSystemId === 'string'
          ? parsed.designSystemId
          : null,
      currentArtifact:
        typeof parsed.currentArtifact === 'string'
          ? parsed.currentArtifact
          : null,
      transcriptMessageCount:
        typeof parsed.transcriptMessageCount === 'number'
          ? parsed.transcriptMessageCount
          : 0,
      model: typeof parsed.model === 'string' ? parsed.model : 'unknown',
      generator: 'neuma-design-mode',
      runId: typeof parsed.runId === 'string' ? parsed.runId : 'unknown',
    };
  } catch {
    return null;
  }
}

async function acquireFinalizeLock(lockPath: string, runId: string) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, 'wx');
    const lock = {
      runId,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf-8');
    await handle.close();
    return { path: lockPath, runId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const holder = await readFinalizeLockHolder(lockPath);
    throw new FinalizeDesignLockedError(holder);
  }
}

async function readFinalizeLockHolder(lockPath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as {
      runId?: unknown;
    };
    return typeof parsed.runId === 'string' ? parsed.runId : null;
  } catch {
    return null;
  }
}

async function releaseFinalizeLock(lock: { path: string; runId: string }) {
  const holderRunId = await readFinalizeLockHolder(lock.path);
  if (holderRunId === lock.runId) {
    await fs.unlink(lock.path).catch(() => {});
  }
}

async function readProjectHistory(projectId: string) {
  const historyPath = resolveProjectPath(
    projectId,
    'history.jsonl',
  ).absolutePath;
  const raw = await fs.readFile(historyPath, 'utf-8').catch(() => '');
  return raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function countRelevantHistoryEvents(history: unknown[]) {
  return history.filter((event) => {
    if (!event || typeof event !== 'object') return true;
    const type = (event as { type?: unknown }).type;
    return type !== 'design.finalized' && type !== 'project.exported';
  }).length;
}

function flattenFiles(files: DesignFileEntry[]): DesignFileEntry[] {
  return files.flatMap((file) => [
    file,
    ...(file.children ? flattenFiles(file.children) : []),
  ]);
}

function pickCurrentArtifact(project: DesignProject, files: DesignFileEntry[]) {
  const paths = new Set(
    files.filter((file) => !file.isDir).map((file) => file.path),
  );
  return (
    project.outputs.find((output) => paths.has(output.path))?.path ??
    [
      'artifacts/index.html',
      'artifacts/deck.html',
      'artifacts/document.md',
    ].find((file) => paths.has(file)) ??
    null
  );
}

function summarizeMarkdown(markdown: string) {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return lines.slice(0, 12).join('\n') || 'Design system content was empty.';
}

function historyLine(event: unknown) {
  if (!event || typeof event !== 'object') return String(event);
  const record = event as { type?: unknown; at?: unknown; path?: unknown };
  return [
    typeof record.at === 'string' ? record.at : null,
    typeof record.type === 'string' ? record.type : 'event',
    typeof record.path === 'string' ? record.path : null,
  ]
    .filter(Boolean)
    .join(' - ');
}

function emptyDesignMdState(): DesignMdState {
  return {
    exists: false,
    generatedAt: null,
    transcriptMessageCount: null,
    designSystemId: null,
    currentArtifact: null,
    isStale: false,
    staleReason: null,
  };
}
