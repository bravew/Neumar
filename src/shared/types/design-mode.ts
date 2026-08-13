export const DESIGN_MEDIA_TASK_PREFIX = 'dmtask_';

export type DesignSurface =
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'deck'
  | 'prototype'
  | 'template'
  | 'campaign';

export type DesignProjectStatus =
  | 'draft'
  | 'ready'
  | 'generating'
  | 'rendering'
  | 'complete'
  | 'failed';

export type DesignProjectIntent =
  | 'landing-page'
  | 'app-screen'
  | 'os-widget'
  | 'live-artifact'
  | 'slide'
  | 'media'
  | 'other';

export interface DesignOutput {
  id: string;
  kind: string;
  path: string;
  mime?: string;
  provider?: string;
  providerId?: string;
  model?: string;
  taskId?: string;
  createdAt: string;
}

export type DesignAssetVersion = DesignOutput;

export interface DesignAssetProvenance {
  assetId?: string;
  projectId?: string;
  surface?: string;
  path?: string;
  provider?: string;
  model?: string;
  promptHash?: string;
  promptSnapshot?: string;
  settings?: Record<string, unknown>;
  references?: string[];
  taskId?: string;
  createdAt?: string;
  disclosureText?: string;
}

export interface DesignExportRecord {
  id: string;
  format: string;
  path: string;
  mime?: string;
  size?: number;
  disclosurePath?: string;
  createdAt: string;
}

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

export interface DesignImportReportItem {
  rule: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export interface DesignComment {
  id: string;
  status: 'open' | 'resolved';
  createdAt: string;
  target?: {
    id?: string;
    selector?: string;
    role?: string;
    label?: string;
    file?: string;
    screen?: string;
    x?: number;
    y?: number;
  };
  text: string;
  attachToChat?: boolean;
  attachments?: DesignCommentAttachment[];
}

export interface DrawStrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface DrawStroke {
  id: string;
  pointerType: 'pen' | 'touch' | 'mouse';
  color: string;
  width: number;
  points: DrawStrokePoint[];
}

export interface DrawAttachment {
  id?: string;
  kind: 'draw';
  strokes: DrawStroke[];
  viewport: { width: number; height: number; scale: number };
}

export interface ImageCommentAttachment {
  id?: string;
  kind: 'image';
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  size: number;
  path?: string;
  dataUrl?: string;
  alt?: string;
}

export interface NoteCommentAttachment {
  id?: string;
  kind: 'note';
  text: string;
}

export type DesignCommentAttachment =
  | DrawAttachment
  | ImageCommentAttachment
  | NoteCommentAttachment;

export interface AppliedManualEditPatch {
  patchId: string;
  appliedAt: string;
  patch: Record<string, unknown> & {
    type: string;
    sourcePath?: string;
    targetId?: string;
    styles?: Record<string, string>;
  };
  sourcePath: string;
  beforeContent: string;
}

export interface RevertedManualEditPatch {
  patchId: string;
  revertedAt: string;
  revertedPatchId: string;
  sourcePath: string;
}

export type ManualEditPatchJournalEntry =
  | AppliedManualEditPatch
  | RevertedManualEditPatch;

export interface DesignSketchFile {
  name: string;
  path: string;
  isDir: false;
  size?: number;
  updatedAt?: string;
}

export interface DesignLintFinding {
  id: string;
  severity: 'p0' | 'p1';
  message: string;
  path?: string;
  suggestion?: string;
}

export interface DesignBudgetConfig {
  maxImageGenerations?: number;
  maxVideoJobs?: number;
  maxVideoSeconds?: number;
  maxAudioSeconds?: number;
  maxRetryCount?: number;
  maxStorageBytes?: number;
  strictProviderMode?: boolean;
}

export interface DesignBudgetUsage {
  imageGenerations: number;
  videoJobs: number;
  videoSeconds: number;
  audioSeconds: number;
  storageBytes: number;
}

export interface DesignBudgetStatus {
  allowed: boolean;
  severity: 'none' | 'soft' | 'urgent' | 'blocked';
  message?: string;
  config: Required<DesignBudgetConfig>;
  used: DesignBudgetUsage;
  requested: Partial<DesignBudgetUsage>;
  remaining: DesignBudgetUsage;
}

export interface DesignFigmaContext {
  url?: string;
  fileKey?: string;
  fileName?: string;
  nodeId?: string;
  nodeName?: string;
}

export interface DesignCodeConnectComponent {
  name: string;
  importPath?: string;
  sourcePath?: string;
  sourceUrl?: string;
  props?: Record<string, unknown>;
  tokenUsage: string[];
  notes?: string;
}

export interface DesignContextPack {
  id: string;
  source: 'figma' | 'code-connect' | 'figma-code-connect';
  title: string;
  summary?: string;
  figma?: DesignFigmaContext;
  components: DesignCodeConnectComponent[];
  notes: string[];
  updatedAt?: string;
}

export interface DesignProjectMetrics {
  projectId: string;
  surface: string;
  status: string;
  assetCount: number;
  exportCount: number;
  assetToExportRatio: number;
  targetedEditCount: number;
  commentCount: number;
  lintFindingCount: number;
  lintP0Count: number;
  lintP1Count: number;
  lintFindingCountsByRule: Record<string, number>;
  exportFormatUsage: Record<string, number>;
  generationByProviderModel: Record<
    string,
    { done: number; failed: number; cancelled: number; running: number }
  >;
  timeToFirstPreviewMs: number | null;
  timeToFirstExportMs: number | null;
  meanRetryCountPerSuccess: number;
}

export type DesignDependencyState = 'available' | 'missing' | 'not-configured';

export interface DesignDependencyStatus {
  id: string;
  label: string;
  kind: 'binary' | 'node-package' | 'renderer';
  state: DesignDependencyState;
  usedFor: string[];
  version?: string;
  reason?: string;
  installHint?: string;
}

export type DesignLiveArtifactSource =
  | { kind: 'inline'; label?: string }
  | { kind: 'project-file'; path: string; label?: string };

export interface DesignLiveArtifact {
  id: string;
  projectId: string;
  title: string;
  status: 'ready' | 'refreshing' | 'failed';
  kind?: string;
  synthesized?: boolean;
  connectorId: string;
  source: DesignLiveArtifactSource;
  templatePath: string;
  dataPath: string;
  entrypointPath: string;
  provenancePath: string;
  refreshLogPath: string;
  createdAt: string;
  updatedAt: string;
  lastRefreshAt?: string;
  lastError?: string;
}

export interface DesignLiveArtifactRefreshLogEntry {
  id: string;
  artifactId: string;
  at: string;
  status: 'ready' | 'failed';
  message?: string;
  dataHash?: string;
  outputPath?: string;
}

export interface DesignConnectorCatalogEntry {
  id: string;
  label: string;
  kind: 'local-project' | 'app-connector';
  access: 'read';
  description: string;
  configured: boolean;
}

export type DesignJuryRole =
  | 'designer'
  | 'critic'
  | 'brand'
  | 'accessibility'
  | 'copy';

export interface DesignJuryRoleScore {
  role: DesignJuryRole;
  score: number;
  evidence: string;
  mustFix: string[];
  quickWins: string[];
}

export interface CritiqueArtifactRef {
  runId: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  url: string;
}

export type PanelEvent =
  | {
      type: 'run_started';
      runId: string;
      protocolVersion: 'design-jury.v1';
      roles: string[];
      startedAt: string;
    }
  | { type: 'panelist_open'; runId: string; round: number; role: string }
  | {
      type: 'panelist_dim';
      runId: string;
      round: number;
      role: string;
      rating: number;
    }
  | {
      type: 'panelist_must_fix';
      runId: string;
      round: number;
      role: string;
      itemId: string;
      body: string;
    }
  | { type: 'panelist_close'; runId: string; round: number; role: string }
  | {
      type: 'round_end';
      runId: string;
      round: number;
      aggregate: { mustFix: number; quickWins: number; avgScore: number };
    }
  | {
      type: 'parser_warning';
      runId: string;
      round: number | null;
      warning: string;
    }
  | { type: 'shipped'; runId: string; artifactRef?: CritiqueArtifactRef }
  | { type: 'degraded'; runId: string; reason: string }
  | { type: 'interrupted'; runId: string }
  | { type: 'failed'; runId: string; error: string };

export interface DesignJuryRun {
  id: string;
  projectId: string;
  artifactPath: string;
  artifactRef?: CritiqueArtifactRef;
  status: 'running' | 'complete' | 'interrupted' | 'failed';
  protocolVersion: 'design-jury.v1';
  createdAt: string;
  completedAt?: string;
  overallScore: number;
  roles: DesignJuryRoleScore[];
  mustFix: string[];
  quickWins: string[];
  transcriptPath: string;
  summaryPath: string;
  error?: string;
  recoveryReason?: 'no_live_handle' | 'daemon_restart';
}

export interface DesignDebugSnapshot {
  project: DesignProject;
  metrics: DesignProjectMetrics;
  prompts: {
    system: string;
    user: string;
    template: unknown | null;
    stack?: DesignPromptStackSnapshot | null;
  };
  provenance: {
    assets: unknown[];
    tasks: unknown[];
    invalidLines: {
      assets: number;
      tasks: number;
      history: number;
    };
  };
  runtimeTasks: DesignTaskRecord[];
  renderLog: string[];
  history: unknown[];
  exports: DesignExportRecord[];
}

export interface DesignPromptStackSnapshot {
  version: 'design-prompt-stack.v1';
  generatedAt: string;
  project: {
    id: string;
    surface: DesignSurface;
    intent: DesignProjectIntent;
    designSystemId: string | null;
    resolvedDesignSystemId: string | null;
    inspirationDesignSystemIds: string[];
    skillId: string | null;
    craftRefs: string[];
    linkedContextDirs: string[];
    contextPackIds: string[];
    promptTemplateId: string | null;
    mediaModel: string | null;
  };
  latestMessageHash: string | null;
  systemHash: string;
  userHash: string;
  sections: Array<{
    id: string;
    title: string;
    bodyHash: string;
    bodyBytes: number;
    cacheControl: 'ephemeral' | null;
  }>;
}

export interface PromptTemplateSnapshot {
  id: string;
  surface: 'image' | 'video';
  title: string;
  prompt: string;
  summary?: string;
  category?: string;
  tags?: string[];
  model?: string;
  aspect?:
    | '1:1'
    | '16:9'
    | '9:16'
    | '4:3'
    | '3:4'
    | '4:5'
    | '5:4'
    | '2:3'
    | '3:2'
    | '21:9';
  previewImageUrl?: string;
  previewVideoUrl?: string;
  source?: {
    repo: string;
    license: string;
    author?: string;
    url?: string;
  };
}

export interface DesignProject {
  id: string;
  title: string;
  workspaceRoot?: string;
  surface: DesignSurface;
  intent?: DesignProjectIntent;
  status: DesignProjectStatus;
  customInstructions?: string;
  skillId: string | null;
  designSystemId: string | null;
  inspirationDesignSystemIds: string[];
  craftRefs: string[];
  linkedContextDirs?: string[];
  contextPacks?: DesignContextPack[];
  brief: Record<string, unknown>;
  media?: {
    model?: string;
    aspect?:
      | '1:1'
      | '16:9'
      | '9:16'
      | '4:3'
      | '3:4'
      | '4:5'
      | '5:4'
      | '2:3'
      | '3:2'
      | '21:9';
    lengthSeconds?: number;
    durationSeconds?: number;
    voice?: string;
    languageBoost?: string;
    audioKind?: 'speech' | 'voiceover' | 'music' | 'sfx' | 'ambience';
    imageStyle?: string;
    references?: string[];
    fidelity?: 'wireframe' | 'high-fidelity';
    speakerNotes?: boolean;
    animations?: boolean;
  };
  budget?: DesignBudgetConfig;
  promptTemplate?: PromptTemplateSnapshot;
  ui?: {
    fileTabs?: {
      order: string[];
    };
    fileWorkspace?: {
      currentDirectory?: string | null;
      sortBy?: 'name' | 'kind' | 'updatedAt';
      sortDirection?: 'asc' | 'desc';
      groupBy?: 'none' | 'kind' | 'updatedAt';
      kindFilter?: 'all' | 'html' | 'image' | 'svg' | 'pdf' | 'audio' | 'video';
    };
  };
  outputs: DesignOutput[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignProjectLocationRecord {
  path: string;
  isDefault: boolean;
  configured: boolean;
  exists: boolean;
  projectCount: number;
  error?: string;
}

export type DesignRoutineTargetMode = 'new_project' | 'existing_project';

export type DesignRoutineSchedule =
  | { kind: 'manual' }
  | { kind: 'hourly'; minute: number; timezone: string }
  | { kind: 'daily'; time: string; timezone: string }
  | { kind: 'weekdays'; time: string; timezone: string }
  | { kind: 'weekly'; weekday: number; time: string; timezone: string };

export interface DesignRoutineAutomationSchedule {
  kind: 'cron';
  cronExpr?: string;
  timezone?: string;
}

export interface DesignRoutine {
  id: string;
  name: string;
  prompt: string;
  surface: DesignSurface;
  targetMode: DesignRoutineTargetMode;
  projectId: string | null;
  enabled: boolean;
  designSystemId: string | null;
  skillId: string | null;
  craftRefs: string[];
  providerProfileId: string | null;
  schedule: DesignRoutineSchedule;
  automationSchedule: DesignRoutineAutomationSchedule | null;
  nextRunAt: string | null;
  lastFiredAt: string | null;
  lastRunId: string | null;
  lastRunSummary: string | null;
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DesignRoutineRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface DesignRoutineRun {
  id: string;
  routineId: string;
  projectId: string | null;
  taskId: string | null;
  status: DesignRoutineRunStatus;
  triggerType: 'manual' | 'schedule';
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  history: Array<Record<string, unknown>>;
}

export interface DesignFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  updatedAt?: string;
  children?: DesignFileEntry[];
}

export interface DesignSystemRecord {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  tokenCss?: string;
  componentsHtml?: string;
  swatches: string[];
  tokens: string[];
  origin?: 'bundled' | 'installed';
  version?: string;
  updateAvailable?: boolean;
  canUninstall?: boolean;
  editable?: boolean;
  // Freshness signals (ISO timestamps) from the pack's meta.json; bundled
  // systems have neither and keep curated order under a `newest` sort.
  installedAt?: string;
  createdAt?: string;
}

export interface DesignSkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  source: string;
  path?: string;
  content?: string;
  icon?: string;
  category?: string;
  trigger?: string;
  origin?: 'builtin' | 'installed';
  version?: string;
  updateAvailable?: boolean;
  canUninstall?: boolean;
  od: {
    mode?: string;
    platform?: 'desktop' | 'mobile';
    featured?: number;
    surface: DesignSurface | 'other';
    scenario?: string;
    preview?: {
      type?: string;
      entry?: string;
      reload?: string;
    };
    examplePrompt?: string;
    craft?: { requires: string[] };
    capabilitiesRequired?: string[];
    warnings: string[];
  };
}

export interface DesignTaskRecord {
  taskId: string;
  projectId: string;
  surface: 'image' | 'video' | 'audio' | 'document';
  model: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  progressLines: string[];
  providerError: string | null;
  verdict?: {
    schemaVersion: 1;
    process: 'running' | 'succeeded' | 'failed' | 'cancelled';
    completeness: 'complete' | 'unfinished' | 'unknown';
    delivery: 'not_expected' | 'pending' | 'delivered' | 'blocked' | 'failed';
    retry: 'not_safe' | 'safe_once' | 'user_action';
    failureCause?: string;
  };
  recoveryAction?: 'retry_generation';
  outputPath?: string;
  provider?: string;
  durationMs?: number;
  usedStubFallback?: boolean;
  prompt?: string;
  requestedUnits?: Partial<DesignBudgetUsage>;
  budgetCheck?: {
    allowed: boolean;
    severity: 'none' | 'soft' | 'urgent' | 'blocked';
    message?: string;
    used: DesignBudgetUsage;
    requested: Partial<DesignBudgetUsage>;
    remaining: DesignBudgetUsage;
  };
}
