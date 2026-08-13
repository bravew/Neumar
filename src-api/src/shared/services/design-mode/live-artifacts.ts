import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  connectorAccessSettingKey,
  type ConnectorAccessSetting,
  type GlobalConnector,
} from '@/shared/auth/connector-policy';
import { getAllConnections } from '@/shared/auth/token-manager';
import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import {
  appendJsonl,
  appendProjectHistory,
  readJsonFile,
  readProjectTextFile,
  resolveProjectPath,
  withProjectLock,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs';
import { addProjectOutput, listDesignProjects } from './projects';
import type {
  CreateDesignLiveArtifactInput,
  DesignConnectorCatalogEntry,
  DesignLiveArtifact,
  DesignLiveArtifactProvenance,
  DesignLiveArtifactRefreshLogEntry,
  DesignLiveArtifactSource,
} from './types';

const logger = createLogger('DesignLiveArtifacts');

const LIVE_ARTIFACT_ROOT = 'live-artifacts';
const LIVE_ARTIFACT_ID_RE = /^live_[a-zA-Z0-9_-]{8,64}$/;
const LIVE_ARTIFACT_MANIFEST = 'artifact.json';
const LIVE_ARTIFACT_SCAFFOLD_FILES = new Set([
  LIVE_ARTIFACT_MANIFEST,
  'template.html',
  'data.json',
  'provenance.json',
  'refresh-log.jsonl',
]);
const APP_CONNECTORS: Array<{
  id: string;
  label: string;
  provider: 'google' | 'notion' | 'slack';
  policyConnector: GlobalConnector;
  description: string;
}> = [
  {
    id: 'google-workspace',
    label: 'Google Workspace',
    provider: 'google',
    policyConnector: 'google',
    description:
      'Read from configured Google Workspace data through Neuma connector policy.',
  },
  {
    id: 'notion',
    label: 'Notion',
    provider: 'notion',
    policyConnector: 'notion',
    description:
      'Read from configured Notion data through Neuma connector policy.',
  },
  {
    id: 'slack',
    label: 'Slack',
    provider: 'slack',
    policyConnector: 'slack_user_token',
    description:
      'Read from configured Slack data through Neuma connector policy.',
  },
];

export async function listDesignConnectorCatalog(): Promise<
  DesignConnectorCatalogEntry[]
> {
  const connections = await getAllConnections();
  const activeProviders = new Set(
    connections
      .filter((connection) => connection.status === 'active')
      .map((connection) => connection.provider),
  );
  return [
    {
      id: 'inline-json',
      label: 'Inline JSON',
      kind: 'local-project',
      access: 'read',
      description:
        'Use JSON supplied in the create request. No external credentials are used.',
      configured: true,
      status: 'ready',
    },
    {
      id: 'project-json',
      label: 'Project JSON file',
      kind: 'local-project',
      access: 'read',
      description:
        'Refresh data from a JSON file already inside the DesignMode project folder.',
      configured: true,
      status: 'ready',
    },
    ...APP_CONNECTORS.map((connector) => ({
      id: connector.id,
      label: connector.label,
      kind: 'app-connector' as const,
      access: 'read' as const,
      description: connector.description,
      configured:
        activeProviders.has(connector.provider) &&
        readDefaultConnectorTier(connector.policyConnector) !== 'disabled',
      status: 'coming-soon' as const,
    })),
  ];
}

export async function listDesignLiveArtifacts(
  projectId: string,
): Promise<DesignLiveArtifact[]> {
  const root = resolveProjectPath(projectId, LIVE_ARTIFACT_ROOT).absolutePath;
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const artifacts = await Promise.all(
    entries.map(async (entry) => {
      if (!LIVE_ARTIFACT_ID_RE.test(entry)) return null;
      try {
        return await readLiveArtifactManifest(projectId, entry);
      } catch {
        return null;
      }
    }),
  );
  return artifacts
    .flatMap((item) => (item ? [item] : []))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function reconcileAllDesignLiveArtifactManifests(): Promise<{
  projects: number;
  artifacts: number;
}> {
  const projects = await listDesignProjects();
  let affectedProjects = 0;
  let artifacts = 0;
  for (const project of projects) {
    const reconciled = await reconcileDesignLiveArtifactManifests(project.id);
    if (reconciled > 0) affectedProjects += 1;
    artifacts += reconciled;
  }
  return { projects: affectedProjects, artifacts };
}

export async function reconcileDesignLiveArtifactManifests(
  projectId: string,
): Promise<number> {
  const root = resolveProjectPath(projectId, LIVE_ARTIFACT_ROOT).absolutePath;
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return 0;
  }

  let reconciled = 0;
  for (const entry of entries) {
    if (!LIVE_ARTIFACT_ID_RE.test(entry)) continue;
    const relativeRoot = `${LIVE_ARTIFACT_ROOT}/${entry}`;
    const manifestPath = resolveProjectPath(
      projectId,
      `${relativeRoot}/${LIVE_ARTIFACT_MANIFEST}`,
    ).absolutePath;
    if (await fileExists(manifestPath)) continue;
    const artifact = await synthesizeLiveArtifactManifest(
      projectId,
      entry,
      relativeRoot,
    );
    if (!artifact) continue;
    await writeLiveArtifactManifest(projectId, artifact);
    logger.info('Synthesized missing DesignMode live artifact manifest', {
      projectId,
      artifactId: artifact.id,
      path: `${relativeRoot}/${LIVE_ARTIFACT_MANIFEST}`,
      kind: artifact.kind,
      synthesized: true,
    });
    reconciled += 1;
  }
  return reconciled;
}

export async function getDesignLiveArtifactDetail(
  projectId: string,
  artifactId: string,
) {
  const artifact = await readLiveArtifactManifest(projectId, artifactId);
  const [templateHtml, data, provenance, refreshLog] = await Promise.all([
    readProjectTextFile(projectId, artifact.templatePath).then(
      (file) => file.content,
    ),
    readJsonFile<unknown>(
      resolveProjectPath(projectId, artifact.dataPath).absolutePath,
      null,
    ),
    readJsonFile<DesignLiveArtifactProvenance | null>(
      resolveProjectPath(projectId, artifact.provenancePath).absolutePath,
      null,
    ),
    readRefreshLog(projectId, artifact.refreshLogPath),
  ]);
  return { artifact, templateHtml, data, provenance, refreshLog };
}

export async function createDesignLiveArtifact(
  projectId: string,
  input: CreateDesignLiveArtifactInput,
): Promise<DesignLiveArtifact> {
  const artifact = await withProjectLock(projectId, async () => {
    const now = new Date().toISOString();
    const artifactId = `live_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const source =
      input.source ?? ({ kind: 'inline' } satisfies DesignLiveArtifactSource);
    const connectorId =
      input.connectorId ??
      (source.kind === 'project-file' ? 'project-json' : 'inline-json');
    const relativeRoot = `${LIVE_ARTIFACT_ROOT}/${artifactId}`;
    const artifact: DesignLiveArtifact = {
      id: artifactId,
      projectId,
      title: input.title?.trim() || 'Live artifact',
      status: 'refreshing',
      connectorId,
      source,
      templatePath: `${relativeRoot}/template.html`,
      dataPath: `${relativeRoot}/data.json`,
      entrypointPath: `${relativeRoot}/index.html`,
      provenancePath: `${relativeRoot}/provenance.json`,
      refreshLogPath: `${relativeRoot}/refresh-log.jsonl`,
      createdAt: now,
      updatedAt: now,
    };

    await writeTextAtomic(
      resolveProjectPath(projectId, artifact.templatePath).absolutePath,
      input.templateHtml,
    );
    const data =
      input.data === undefined
        ? await readSourceData(projectId, source)
        : input.data;
    const refreshed = await writeLiveArtifactRender(
      artifact,
      input.templateHtml,
      data,
    );
    await writeLiveArtifactManifest(projectId, refreshed);
    await appendProjectHistory(projectId, {
      type: 'live-artifact.created',
      at: refreshed.updatedAt,
      artifactId,
      entrypointPath: refreshed.entrypointPath,
      connectorId,
    });
    return refreshed;
  });

  await addProjectOutput(projectId, {
    id: artifact.id,
    kind: 'live-artifact',
    path: artifact.entrypointPath,
    mime: 'text/html',
    provider: 'design-mode',
    model: artifact.connectorId,
    createdAt: artifact.createdAt,
  });
  logger.info(`Created DesignMode live artifact ${artifact.id}`);
  return artifact;
}

export async function refreshDesignLiveArtifact(
  projectId: string,
  artifactId: string,
): Promise<DesignLiveArtifact> {
  return withProjectLock(projectId, async () => {
    const current = await readLiveArtifactManifest(projectId, artifactId);
    const template = await readProjectTextFile(projectId, current.templatePath);
    try {
      const data =
        current.source.kind === 'inline'
          ? await readJsonFile<unknown>(
              resolveProjectPath(projectId, current.dataPath).absolutePath,
              {},
            )
          : await readSourceData(projectId, current.source);
      const refreshed = await writeLiveArtifactRender(
        { ...current, status: 'refreshing' },
        template.content,
        data,
      );
      await writeLiveArtifactManifest(projectId, refreshed);
      await appendProjectHistory(projectId, {
        type: 'live-artifact.refreshed',
        at: refreshed.updatedAt,
        artifactId,
        status: 'ready',
      });
      return refreshed;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failed: DesignLiveArtifact = {
        ...current,
        status: 'failed',
        updatedAt: failedAt,
        lastRefreshAt: failedAt,
        lastError: (error as Error).message,
      };
      await appendRefreshLog(projectId, failed.refreshLogPath, {
        id: randomUUID(),
        artifactId,
        at: failedAt,
        status: 'failed',
        message: failed.lastError,
      });
      await writeLiveArtifactManifest(projectId, failed);
      await appendProjectHistory(projectId, {
        type: 'live-artifact.refresh-failed',
        at: failedAt,
        artifactId,
        message: failed.lastError,
      });
      return failed;
    }
  });
}

async function readLiveArtifactManifest(
  projectId: string,
  artifactId: string,
): Promise<DesignLiveArtifact> {
  assertLiveArtifactId(artifactId);
  const raw = await fs.readFile(
    resolveProjectPath(
      projectId,
      `${LIVE_ARTIFACT_ROOT}/${artifactId}/artifact.json`,
    ).absolutePath,
    'utf-8',
  );
  const artifact = JSON.parse(raw) as DesignLiveArtifact;
  if (!artifact?.id) throw new Error('Live artifact not found');
  return artifact;
}

async function writeLiveArtifactManifest(
  projectId: string,
  artifact: DesignLiveArtifact,
): Promise<void> {
  await writeJsonAtomic(
    resolveProjectPath(
      projectId,
      `${LIVE_ARTIFACT_ROOT}/${artifact.id}/artifact.json`,
    ).absolutePath,
    artifact,
  );
}

async function synthesizeLiveArtifactManifest(
  projectId: string,
  artifactId: string,
  relativeRoot: string,
): Promise<DesignLiveArtifact | null> {
  const entrypointPath = await findEntrypoint(projectId, relativeRoot);
  if (!entrypointPath) return null;

  const entrypoint = resolveProjectPath(projectId, entrypointPath);
  const entrypointStat = await fs.stat(entrypoint.absolutePath);
  const now = new Date().toISOString();
  const createdAt =
    entrypointStat.birthtimeMs > 0
      ? entrypointStat.birthtime.toISOString()
      : entrypointStat.mtime.toISOString();
  const updatedAt = entrypointStat.mtime.toISOString();
  const templatePath = `${relativeRoot}/template.html`;
  const dataPath = `${relativeRoot}/data.json`;
  const provenancePath = `${relativeRoot}/provenance.json`;
  const refreshLogPath = `${relativeRoot}/refresh-log.jsonl`;
  const templateAbsolute = resolveProjectPath(
    projectId,
    templatePath,
  ).absolutePath;
  const dataAbsolute = resolveProjectPath(projectId, dataPath).absolutePath;
  const provenanceAbsolute = resolveProjectPath(
    projectId,
    provenancePath,
  ).absolutePath;
  const refreshLogAbsolute = resolveProjectPath(
    projectId,
    refreshLogPath,
  ).absolutePath;

  if (!(await fileExists(templateAbsolute))) {
    const entrypointContent = await fs.readFile(
      entrypoint.absolutePath,
      'utf-8',
    );
    await writeTextAtomic(templateAbsolute, entrypointContent);
  }
  if (!(await fileExists(dataAbsolute))) {
    await writeJsonAtomic(dataAbsolute, {});
  }
  if (!(await fileExists(provenanceAbsolute))) {
    await writeJsonAtomic(provenanceAbsolute, {
      schema: 'neuma.design.live-artifact.provenance.v1',
      artifactId,
      projectId,
      connectorId: 'reconciled',
      source: { kind: 'inline', label: 'Reconciled from disk' },
      generatedAt: now,
      generator: 'neuma-design-mode',
      templateHash: 'sha256:unknown',
      dataHash: 'sha256:unknown',
      outputPath: entrypointPath,
      synthesized: true,
    });
  }
  if (!(await fileExists(refreshLogAbsolute))) {
    await writeTextAtomic(refreshLogAbsolute, '');
  }

  return {
    id: artifactId,
    projectId,
    title: titleFromArtifactId(artifactId),
    status: 'ready',
    kind: liveArtifactKindFromPath(entrypointPath),
    synthesized: true,
    connectorId: 'reconciled',
    source: { kind: 'inline', label: 'Reconciled from disk' },
    templatePath,
    dataPath,
    entrypointPath,
    provenancePath,
    refreshLogPath,
    createdAt,
    updatedAt,
    lastRefreshAt: updatedAt,
  };
}

async function findEntrypoint(
  projectId: string,
  relativeRoot: string,
): Promise<string | null> {
  const candidates = [
    'index.html',
    'index.htm',
    'index.md',
    'index.svg',
    'index.json',
    'index.txt',
  ];
  for (const candidate of candidates) {
    const relativePath = `${relativeRoot}/${candidate}`;
    if (
      await fileExists(resolveProjectPath(projectId, relativePath).absolutePath)
    ) {
      return relativePath;
    }
  }

  let entries: string[];
  try {
    entries = await fs.readdir(
      resolveProjectPath(projectId, relativeRoot).absolutePath,
    );
  } catch {
    return null;
  }
  const fallback = entries
    .filter((entry) => !LIVE_ARTIFACT_SCAFFOLD_FILES.has(entry))
    .find((entry) =>
      ['.html', '.htm', '.md', '.svg', '.json', '.txt'].includes(
        path.extname(entry).toLowerCase(),
      ),
    );
  return fallback ? `${relativeRoot}/${fallback}` : null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function liveArtifactKindFromPath(relativePath: string): string {
  switch (path.extname(relativePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'html';
    case '.md':
      return 'markdown';
    case '.svg':
      return 'svg';
    case '.json':
      return 'json';
    case '.txt':
      return 'text';
    default:
      return 'file';
  }
}

function titleFromArtifactId(artifactId: string): string {
  return artifactId
    .replace(/^live_/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function writeLiveArtifactRender(
  artifact: DesignLiveArtifact,
  templateHtml: string,
  data: unknown,
): Promise<DesignLiveArtifact> {
  const now = new Date().toISOString();
  const dataJson = stableJson(data);
  const indexHtml = renderLiveArtifactHtml(templateHtml, dataJson);
  const dataHash = sha256(dataJson);
  const templateHash = sha256(templateHtml);
  const projectId = artifact.projectId;
  const ready: DesignLiveArtifact = {
    ...artifact,
    status: 'ready',
    updatedAt: now,
    lastRefreshAt: now,
    lastError: undefined,
  };
  const provenance: DesignLiveArtifactProvenance = {
    schema: 'neuma.design.live-artifact.provenance.v1',
    artifactId: artifact.id,
    projectId,
    connectorId: artifact.connectorId,
    source: artifact.source,
    generatedAt: now,
    generator: 'neuma-design-mode',
    templateHash,
    dataHash,
    outputPath: artifact.entrypointPath,
  };

  await writeTextAtomic(
    resolveProjectPath(projectId, artifact.dataPath).absolutePath,
    dataJson,
  );
  await writeTextAtomic(
    resolveProjectPath(projectId, artifact.entrypointPath).absolutePath,
    indexHtml,
  );
  await writeJsonAtomic(
    resolveProjectPath(projectId, artifact.provenancePath).absolutePath,
    provenance,
  );
  await appendRefreshLog(projectId, artifact.refreshLogPath, {
    id: randomUUID(),
    artifactId: artifact.id,
    at: now,
    status: 'ready',
    dataHash,
    outputPath: artifact.entrypointPath,
  });
  return ready;
}

async function readSourceData(
  projectId: string,
  source: DesignLiveArtifactSource,
): Promise<unknown> {
  if (source.kind === 'inline') {
    void projectId;
    return {};
  }
  const file = await readProjectTextFile(projectId, source.path);
  return JSON.parse(file.content) as unknown;
}

function renderLiveArtifactHtml(
  templateHtml: string,
  dataJson: string,
): string {
  if (templateHtml.includes('{{DATA_JSON}}')) {
    return templateHtml.split('{{DATA_JSON}}').join(escapeScriptJson(dataJson));
  }
  const dataScript = `<script type="application/json" id="neuma-live-data">${escapeScriptJson(dataJson)}</script>`;
  return /<\/body>/i.test(templateHtml)
    ? templateHtml.replace(/<\/body>/i, `${dataScript}</body>`)
    : `${templateHtml}\n${dataScript}\n`;
}

async function readRefreshLog(
  projectId: string,
  relativePath: string,
): Promise<DesignLiveArtifactRefreshLogEntry[]> {
  try {
    const file = await readProjectTextFile(projectId, relativePath);
    return file.content
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DesignLiveArtifactRefreshLogEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function appendRefreshLog(
  projectId: string,
  relativePath: string,
  entry: DesignLiveArtifactRefreshLogEntry,
): Promise<void> {
  await appendJsonl(
    resolveProjectPath(projectId, relativePath).absolutePath,
    entry,
  );
}

function assertLiveArtifactId(artifactId: string): void {
  if (!LIVE_ARTIFACT_ID_RE.test(artifactId)) {
    throw new Error('Invalid live artifact id');
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function escapeScriptJson(value: string): string {
  return value
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function readDefaultConnectorTier(
  connector: GlobalConnector,
): ConnectorAccessSetting['defaultTier'] {
  const raw = getSetting(connectorAccessSettingKey(connector));
  if (!raw) return 'admin';
  try {
    const parsed = JSON.parse(raw) as ConnectorAccessSetting;
    return parsed.defaultTier ?? 'admin';
  } catch {
    return 'admin';
  }
}
