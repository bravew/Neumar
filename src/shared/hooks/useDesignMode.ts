import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { materializationBudgetErrorFromApiData } from '@/shared/assets';
import type {
  DesignAssetProvenance,
  DesignAssetVersion,
  DesignBudgetStatus,
  DesignComment,
  DesignConnectorCatalogEntry,
  DesignDebugSnapshot,
  DesignDependencyStatus,
  DesignExportRecord,
  DesignFileEntry,
  DesignImportReportItem,
  DesignJuryRun,
  DesignMdState,
  DesignLiveArtifact,
  DesignLiveArtifactRefreshLogEntry,
  DesignLiveArtifactSource,
  DesignLintFinding,
  DesignCommentAttachment,
  ManualEditPatchJournalEntry,
  DesignProject,
  DesignProjectLocationRecord,
  DesignRoutine,
  DesignRoutineRun,
  DesignRoutineSchedule,
  DesignSketchFile,
  DesignSkillRecord,
  DesignSurface,
  DesignSystemRecord,
  FinalizeDesignResult,
  DesignTaskRecord,
  PromptTemplateSnapshot,
} from '@/shared/types/design-mode';
import { randomUUID } from '@/shared/utils/uuid';

export class DesignApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DesignApiError';
  }
}

async function designApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/design${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const data = (await response.json()) as T & {
    error?: string;
  } & Record<string, unknown>;
  if (!response.ok) {
    const budgetError = materializationBudgetErrorFromApiData(
      data,
      data.error || `HTTP ${response.status}`,
    );
    if (budgetError) throw budgetError;
    throw new DesignApiError(
      data.error || `HTTP ${response.status}`,
      response.status,
      data,
    );
  }
  return data;
}

export function useDesignProjects() {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await designApi<{ projects: DesignProject[] }>('/projects');
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, loading, error, refresh, setProjects };
}

export async function listDesignProjectLocations(init?: RequestInit) {
  return designApi<{ locations: DesignProjectLocationRecord[] }>(
    '/project-locations',
    init,
  );
}

export async function addDesignProjectLocation(path: string) {
  return designApi<{
    location: DesignProjectLocationRecord;
    locations: DesignProjectLocationRecord[];
  }>('/project-locations', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function removeDesignProjectLocation(path: string) {
  return designApi<{ locations: DesignProjectLocationRecord[] }>(
    '/project-locations',
    {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    },
  );
}

export async function scanDesignProjectLocations() {
  return designApi<{
    locations: DesignProjectLocationRecord[];
    projects: DesignProject[];
  }>('/project-locations/scan');
}

export function useDesignCatalogs(surface: DesignSurface) {
  const [designSystems, setDesignSystems] = useState<DesignSystemRecord[]>([]);
  const [skills, setSkills] = useState<DesignSkillRecord[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [imageTemplates, setImageTemplates] = useState<
    PromptTemplateSnapshot[]
  >([]);
  const [videoTemplates, setVideoTemplates] = useState<
    PromptTemplateSnapshot[]
  >([]);

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      designApi<{ designSystems: DesignSystemRecord[] }>('/design-systems', {
        signal: ac.signal,
      }),
      designApi<{ skills: DesignSkillRecord[] }>('/skills', {
        signal: ac.signal,
      }),
      designApi<{ templates: PromptTemplateSnapshot[] }>(
        '/prompt-templates?surface=image',
        { signal: ac.signal },
      ),
      designApi<{ templates: PromptTemplateSnapshot[] }>(
        '/prompt-templates?surface=video',
        { signal: ac.signal },
      ),
    ])
      .then(([systems, skillData, imageData, videoData]) => {
        setDesignSystems(systems.designSystems);
        setSkills(skillData.skills);
        setImageTemplates(imageData.templates);
        setVideoTemplates(videoData.templates);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [refreshTick, surface]);

  return { designSystems, skills, imageTemplates, videoTemplates, refresh };
}

export async function createDesignProject(input: {
  title?: string;
  workspaceRoot?: string;
  surface: DesignSurface;
  intent?: DesignProject['intent'];
  customInstructions?: string;
  designSystemId?: string | null;
  inspirationDesignSystemIds?: string[];
  skillId?: string | null;
  linkedContextDirs?: string[];
  contextPacks?: DesignProject['contextPacks'];
  brief?: Record<string, unknown>;
  media?: DesignProject['media'];
  promptTemplate?: PromptTemplateSnapshot;
}) {
  return designApi<{ project: DesignProject }>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function useDesignRoutines() {
  const [routines, setRoutines] = useState<DesignRoutine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await designApi<{ routines: DesignRoutine[] }>('/routines');
      setRoutines(data.routines);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { routines, loading, error, refresh, setRoutines };
}

export async function createDesignRoutine(input: {
  name: string;
  prompt: string;
  surface: DesignSurface;
  targetMode: 'new_project' | 'existing_project';
  projectId?: string | null;
  enabled?: boolean;
  designSystemId?: string | null;
  skillId?: string | null;
  craftRefs?: string[];
  providerProfileId?: string | null;
  schedule?: DesignRoutineSchedule;
}) {
  return designApi<{ routine: DesignRoutine }>('/routines', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateDesignRoutine(
  routineId: string,
  patch: Partial<DesignRoutine>,
) {
  return designApi<{ routine: DesignRoutine }>(`/routines/${routineId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function runDesignRoutine(routineId: string) {
  return designApi<{ run: DesignRoutineRun }>(`/routines/${routineId}/run`, {
    method: 'POST',
    body: JSON.stringify({ waitForCompletion: false }),
  });
}

export async function listDesignRoutineRuns(routineId: string) {
  return designApi<{ runs: DesignRoutineRun[] }>(`/routines/${routineId}/runs`);
}

export async function updateDesignProject(
  projectId: string,
  patch: Partial<DesignProject>,
) {
  return designApi<{ project: DesignProject }>(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteDesignProject(projectId: string) {
  return designApi<{ ok: true }>(`/projects/${projectId}`, {
    method: 'DELETE',
  });
}

export async function postDesignMessageFeedback(
  projectId: string,
  messageId: string,
  input: {
    rating: 'up' | 'down';
    comment?: string;
    submittedAt: string;
    artifactRef?: string;
    runId?: string;
  },
) {
  return designApi<{ feedback: unknown }>(
    `/projects/${projectId}/messages/${encodeURIComponent(messageId)}/feedback`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function getDesignProject(projectId: string, init?: RequestInit) {
  return designApi<{ project: DesignProject }>(`/projects/${projectId}`, init);
}

export async function finalizeDesignProject(projectId: string) {
  return designApi<{ result: FinalizeDesignResult }>(
    `/projects/${projectId}/finalize`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function getDesignMdState(projectId: string, init?: RequestInit) {
  return designApi<{ state: DesignMdState }>(
    `/projects/${projectId}/finalize/state`,
    init,
  );
}

export async function getDesignDebugSnapshot(projectId: string) {
  return designApi<{ snapshot: DesignDebugSnapshot }>(
    `/projects/${projectId}/debug`,
  );
}

export async function getDesignDependencies(init?: RequestInit) {
  return designApi<{ dependencies: DesignDependencyStatus[] }>(
    '/dependencies',
    init,
  );
}

export async function getDesignConnectors() {
  return designApi<{ connectors: DesignConnectorCatalogEntry[] }>(
    '/connectors',
  );
}

export async function listDesignSystems(init?: RequestInit) {
  return designApi<{ designSystems: DesignSystemRecord[] }>(
    '/design-systems',
    init,
  );
}

/**
 * Full record for one design system, including the heavy `componentsHtml`
 * preview that {@link listDesignSystems} omits in summary mode. Used by the
 * catalog grid's lazy live preview.
 */
export async function getDesignSystem(id: string, init?: RequestInit) {
  return designApi<{ designSystem: DesignSystemRecord | null }>(
    `/design-systems/${encodeURIComponent(id)}`,
    init,
  );
}

/**
 * Generated "Showcase" page (Open Design parity) — a token-driven marketing
 * surface synthesized server-side from the system's DESIGN.md. Returns raw
 * HTML (not JSON) for direct sandboxed-iframe rendering. Distinct from the
 * bundled `components.html` reference fixture on the record.
 */
export async function getDesignSystemShowcase(
  id: string,
  init?: RequestInit,
): Promise<string> {
  const response = await fetch(
    `${API_BASE_URL}/design/design-systems/${encodeURIComponent(id)}/showcase`,
    init,
  );
  if (!response.ok) {
    throw new DesignApiError(`HTTP ${response.status}`, response.status, {});
  }
  return response.text();
}

export async function installDesignSystemCatalogPack(id: string) {
  return designApi<{ designSystem: DesignSystemRecord }>(
    `/design-systems/${encodeURIComponent(id)}/install`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function importShadcnRegistryDesignSystem(input: {
  url: string;
  item?: string;
}) {
  return designApi<{ designSystem: DesignSystemRecord }>(
    '/design-systems/import/shadcn-registry',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function uninstallDesignSystemCatalogPack(id: string) {
  return designApi<{ ok: true }>(
    `/design-systems/${encodeURIComponent(id)}/install`,
    { method: 'DELETE' },
  );
}

export async function updateDesignSystemCatalogPack(
  id: string,
  patch: { title?: string; body?: string },
) {
  return designApi<{ designSystem: DesignSystemRecord }>(
    `/design-systems/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export async function installDesignSkillCatalogPack(id: string) {
  return designApi<{ skill: DesignSkillRecord }>(
    `/skills/${encodeURIComponent(id)}/install`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function uninstallDesignSkillCatalogPack(id: string) {
  return designApi<{ ok: true }>(`/skills/${encodeURIComponent(id)}/install`, {
    method: 'DELETE',
  });
}

export async function listDesignLiveArtifacts(projectId: string) {
  return designApi<{ liveArtifacts: DesignLiveArtifact[] }>(
    `/projects/${projectId}/live-artifacts`,
  );
}

export async function createDesignLiveArtifact(
  projectId: string,
  input: {
    title?: string;
    templateHtml: string;
    data?: unknown;
    source?: DesignLiveArtifactSource;
    connectorId?: string;
  },
) {
  return designApi<{ liveArtifact: DesignLiveArtifact }>(
    `/projects/${projectId}/live-artifacts`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function getDesignLiveArtifact(
  projectId: string,
  artifactId: string,
) {
  return designApi<{
    artifact: DesignLiveArtifact;
    templateHtml: string;
    data: unknown;
    provenance: unknown;
    refreshLog: DesignLiveArtifactRefreshLogEntry[];
  }>(`/projects/${projectId}/live-artifacts/${artifactId}`);
}

export async function refreshDesignLiveArtifact(
  projectId: string,
  artifactId: string,
) {
  return designApi<{ liveArtifact: DesignLiveArtifact }>(
    `/projects/${projectId}/live-artifacts/${artifactId}/refresh`,
    { method: 'POST' },
  );
}

export async function getDesignJuryStatus(init?: RequestInit) {
  return designApi<{ enabled: boolean }>('/design-jury/status', init);
}

export async function listDesignJuryRuns(projectId: string) {
  return designApi<{ runs: DesignJuryRun[] }>(
    `/projects/${projectId}/design-jury`,
  );
}

export async function runDesignJury(
  projectId: string,
  input: { artifactPath?: string },
) {
  return designApi<{ run: DesignJuryRun }>(
    `/projects/${projectId}/design-jury`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function listDesignFiles(projectId: string, init?: RequestInit) {
  return designApi<{ files: DesignFileEntry[] }>(
    `/projects/${projectId}/files`,
    init,
  );
}

export async function readDesignFile(
  projectId: string,
  filePath: string,
  init?: RequestInit,
) {
  return designApi<{ path: string; content: string }>(
    `/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`,
    init,
  );
}

export async function writeDesignFile(
  projectId: string,
  filePath: string,
  content: string,
) {
  return designApi<{ file: DesignFileEntry; lint: DesignLintFinding[] }>(
    `/projects/${projectId}/file`,
    {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content }),
    },
  );
}

export async function deleteDesignFiles(projectId: string, paths: string[]) {
  return designApi<{
    deleted: Array<{ path: string; trashPath: string; size: number }>;
    project: DesignProject;
  }>(`/projects/${projectId}/files`, {
    method: 'DELETE',
    body: JSON.stringify({ paths }),
  });
}

export async function renameDesignFile(
  projectId: string,
  from: string,
  to: string,
) {
  return designApi<{ file: DesignFileEntry; project: DesignProject }>(
    `/projects/${projectId}/files/rename`,
    {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    },
  );
}

export async function lintDesignFile(
  projectId: string,
  input: { path?: string; content?: string },
) {
  return designApi<{ findings: DesignLintFinding[] }>(
    `/projects/${projectId}/lint`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function postDesignEditTarget(
  projectId: string,
  input: {
    target: Record<string, unknown>;
    instruction: string;
    scope?: 'targeted';
  },
) {
  return designApi<{ ok: true }>(`/projects/${projectId}/edit-target`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function applyDesignEditPatch(
  projectId: string,
  patch: Record<string, unknown>,
) {
  return designApi<{ patch: ManualEditPatchJournalEntry }>(
    `/projects/${projectId}/edit/patch`,
    {
      method: 'POST',
      body: JSON.stringify(patch),
    },
  );
}

export async function listDesignEditPatches(
  projectId: string,
  init?: RequestInit,
) {
  return designApi<{ patches: ManualEditPatchJournalEntry[] }>(
    `/projects/${projectId}/edit/patches`,
    init,
  );
}

export async function revertDesignEditPatch(
  projectId: string,
  patchId: string,
) {
  return designApi<{ patch: ManualEditPatchJournalEntry }>(
    `/projects/${projectId}/edit/revert`,
    {
      method: 'POST',
      body: JSON.stringify({ patchId }),
    },
  );
}

export async function postDesignComment(
  projectId: string,
  input: {
    target?: Record<string, unknown>;
    text: string;
    attachToChat?: boolean;
    attachments?: DesignCommentAttachment[];
  },
) {
  return designApi<{ comment: DesignComment }>(
    `/projects/${projectId}/comments`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function listDesignComments(
  projectId: string,
  init?: RequestInit,
) {
  return designApi<{ comments: DesignComment[] }>(
    `/projects/${projectId}/comments`,
    init,
  );
}

export async function updateDesignComment(
  projectId: string,
  commentId: string,
  patch: Partial<DesignComment>,
) {
  return designApi<{ comments: DesignComment[] }>(
    `/projects/${projectId}/comments/${commentId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

export async function deleteDesignComment(
  projectId: string,
  commentId: string,
) {
  return designApi<{ comments: DesignComment[] }>(
    `/projects/${projectId}/comments/${commentId}`,
    {
      method: 'DELETE',
    },
  );
}

export async function listDesignSketches(projectId: string) {
  return designApi<{ sketches: DesignSketchFile[] }>(
    `/projects/${projectId}/sketches`,
  );
}

export async function postDesignSketch(
  projectId: string,
  input: { screenId?: string; document?: unknown },
) {
  return designApi<{ screenId: string }>(`/projects/${projectId}/sketches`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function startDesignMedia(
  projectId: string,
  input: {
    surface: 'image' | 'video' | 'audio' | 'document';
    prompt: string;
    model?: string;
    aspect?: string;
    lengthSeconds?: number;
    durationSeconds?: number;
    audioKind?: string;
    voice?: string;
    languageBoost?: string;
  },
) {
  return designApi<{ taskId: string; task: DesignTaskRecord }>(
    `/projects/${projectId}/media`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function listDesignMediaTasks(
  projectId: string,
  init?: RequestInit,
) {
  return designApi<{ tasks: DesignTaskRecord[] }>(
    `/projects/${projectId}/tasks`,
    init,
  );
}

export async function waitDesignMedia(projectId: string, taskId: string) {
  return designApi<{
    status: DesignTaskRecord['state'];
    task: DesignTaskRecord;
    file?: unknown;
    progress: string[];
    providerError?: string;
  }>(`/projects/${projectId}/tasks/${taskId}/wait`);
}

export async function cancelDesignMediaTask(projectId: string, taskId: string) {
  return designApi<{ task: DesignTaskRecord }>(
    `/projects/${projectId}/tasks/${taskId}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export async function resolveDesignPrompt(
  projectId: string,
  latestMessage: string,
) {
  return designApi<{ system: string; user: string }>(
    `/projects/${projectId}/resolve-prompt`,
    {
      method: 'POST',
      body: JSON.stringify({ latestMessage }),
    },
  );
}

export interface DesignEditor {
  id: string;
  label: string;
  available: boolean;
}

export async function listDesignEditors() {
  return designApi<{ editors: DesignEditor[] }>('/editors');
}

/** Absolute project-root path, for the hand-off menu's copy-path / CLI actions. */
export async function getDesignProjectDir(projectId: string) {
  return designApi<{ path: string }>(`/projects/${projectId}/dir`);
}

export async function openDesignInEditor(projectId: string, editorId: string) {
  return designApi<{ ok: boolean }>(`/projects/${projectId}/open-in`, {
    method: 'POST',
    body: JSON.stringify({ editorId }),
  });
}

export async function getDesignCapabilities(
  projectId: string,
  init?: RequestInit,
) {
  return designApi<{
    capabilities: unknown;
    budget: DesignBudgetStatus;
    projectId: string;
  }>(`/projects/${projectId}/capabilities`, init);
}

export async function getPromptTemplateDetail(
  surface: 'image' | 'video',
  id: string,
) {
  return designApi<{ template: PromptTemplateSnapshot }>(
    `/prompt-templates/${surface}/${id}`,
  );
}

export async function getDesignSkillExample(id: string) {
  const response = await fetch(
    `${API_BASE_URL}/design/skills/${encodeURIComponent(id)}/example`,
  );
  if (!response.ok) return null;
  return response.text();
}

export async function importDesignProject(
  input:
    | {
        title?: string;
        surface: DesignSurface;
        entrypoint?: string;
        archiveBase64?: string;
        archiveName?: string;
        allowLintOverride?: boolean;
        files?: Array<{ path: string; content?: string; dataBase64?: string }>;
      }
    | FormData,
) {
  const isMultipart = input instanceof FormData;
  const response = await fetch(`${API_BASE_URL}/design/projects/import`, {
    method: 'POST',
    headers: isMultipart ? undefined : { 'Content-Type': 'application/json' },
    body: isMultipart ? input : JSON.stringify(input),
  });
  const data = (await response.json()) as {
    ok: boolean;
    project?: DesignProject;
    report?: DesignImportReportItem[];
    error?: string;
  };
  if (!response.ok && !data.report) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function importDesignFolder(input: {
  path: string;
  title?: string;
  surface?: DesignSurface;
}) {
  return designApi<{
    project: DesignProject;
    summary: { path: string; fileCount: number; totalBytes: number };
  }>('/projects/import-folder', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listDesignExports(projectId: string, init?: RequestInit) {
  return designApi<{ exports: DesignExportRecord[] }>(
    `/projects/${projectId}/exports`,
    init,
  );
}

export async function getDesignFileLocation(
  projectId: string,
  filePath: string,
) {
  return designApi<{ path: string; absolutePath: string }>(
    `/projects/${projectId}/file-location?path=${encodeURIComponent(filePath)}`,
  );
}

export async function exportDesignProject(
  projectId: string,
  format: string,
  options?: { allowLintOverride?: boolean },
) {
  return designApi<{ export: DesignExportRecord }>(
    `/projects/${projectId}/export`,
    {
      method: 'POST',
      body: JSON.stringify({
        format,
        allowLintOverride: options?.allowLintOverride,
      }),
    },
  );
}

export interface ArtifactPdfInput {
  baseHref: string;
  deck: boolean;
  defaultFilename: string;
  html: string;
  title?: string;
}

export async function buildDesignPdfExportInput(
  projectId: string,
  options?: {
    artifactPath?: string;
    deck?: boolean;
    fileName?: string;
    title?: string;
  },
) {
  return designApi<{ buildInput: ArtifactPdfInput }>(
    `/projects/${projectId}/export/pdf-input`,
    {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    },
  );
}

export async function exportDesignPackage(
  projectId: string,
  options?: {
    include?: {
      transcript?: boolean;
      assets?: boolean;
      providerKeys?: false;
    };
  },
) {
  return designApi<{
    path: string;
    sha256: string;
    sizeBytes: number;
    manifest: unknown;
  }>(`/projects/${projectId}/export/design-package`, {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

export async function attachCatalogAssetToDesign(
  projectId: string,
  assetId: string,
  input?: { role?: 'reference' | 'inline'; sessionId?: string },
) {
  return designApi<{
    project: DesignProject;
    asset: DesignAssetVersion;
    materialization: unknown;
  }>(
    `/projects/${encodeURIComponent(projectId)}/catalog-assets/${encodeURIComponent(assetId)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        role: input?.role ?? 'reference',
        sessionId: input?.sessionId,
        clientRequestId: randomUUID(),
      }),
    },
  );
}

export async function listDesignAssetVersions(
  projectId: string,
  assetId: string,
) {
  return designApi<{ versions: DesignAssetVersion[] }>(
    `/projects/${projectId}/assets/${assetId}/versions`,
  );
}

export async function promoteDesignAssetVersion(
  projectId: string,
  assetId: string,
  filePath: string,
) {
  return designApi<{ project: DesignProject }>(
    `/projects/${projectId}/assets/${assetId}/promote-version`,
    {
      method: 'POST',
      body: JSON.stringify({ path: filePath }),
    },
  );
}

export async function getDesignAssetProvenance(
  projectId: string,
  assetId: string,
) {
  return designApi<{ provenance: DesignAssetProvenance | null }>(
    `/projects/${projectId}/assets/${assetId}/provenance`,
  );
}

export function designBlobUrl(projectId: string, filePath: string) {
  return `${API_BASE_URL}/design/projects/${encodeURIComponent(projectId)}/blob?path=${encodeURIComponent(filePath)}`;
}
