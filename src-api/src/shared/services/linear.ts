/**
 * Linear Service
 *
 * Uses @linear/sdk LinearClient for GraphQL API access.
 * Functional pattern with module-level state.
 */

import { IssueRelationType, LinearClient } from '@linear/sdk';
import {
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_FIELD,
  LinearWebhookClient,
} from '@linear/sdk/webhooks';

import { createLogger } from '@/shared/utils/logger';

import { getLinearAccessToken, invalidateLinearToken } from './linear-auth';
import type { LinearConfig } from './linear-config';
import { getLinearConfig } from './linear-config';
import { enqueue } from './pipeline';
import { getRunEnv } from './session-context';

const logger = createLogger('LinearService');

// ============================================================================
// Types
// ============================================================================

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  labels: string[];
  state: { id: string; name: string };
  team: { id: string; key: string };
  assignee: { id: string; name: string } | null;
  url: string;
  updatedAt: string;
  parent?: { id: string; identifier: string; title: string };
  children?: { id: string; identifier: string; title: string }[];
}

export interface TicketClassification {
  type: 'feature' | 'bug' | 'chore' | 'refactor';
  branchPrefix: string;
  priority: number;
  scope: string;
}

export interface WorkflowState {
  id: string;
  name: string;
  type: string;
}

// ============================================================================
// Module-level state
// ============================================================================

let linearClient: LinearClient | null = null;
let linearClientApiKey: string | null = null;
let webhookClient: LinearWebhookClient | null = null;
let webhookClientSecret: string | null = null;

// ============================================================================
// Client management
// ============================================================================

/**
 * Initialize or get Linear client.
 *
 * Resolution order:
 *   1. Per-turn user PAT in `SessionContext.userCredentials.LINEAR_API_KEY`
 *      (Slack App Home credential). Returns an ephemeral client per call —
 *      never poisons the module-level cache, so concurrent runs with
 *      different users' keys can't observe each other's clients.
 *   2. Explicit `apiKey` argument (used by initialization paths).
 *   3. Module-level cached client (one global key, lazily resolved from
 *      `getLinearConfig()`).
 */
export function getLinearClient(apiKey?: string): LinearClient {
  const ctxKey = getRunEnv('LINEAR_API_KEY');
  // The cached global client (if any) was built from `getLinearConfig()`. If
  // the per-turn key matches that, reuse the cache; otherwise build an
  // ephemeral client so concurrent runs with different users' keys can't
  // observe each other.
  if (ctxKey && ctxKey !== linearClientApiKey) {
    return new LinearClient({ apiKey: ctxKey });
  }
  const key = apiKey ?? linearClientApiKey;
  if (!key) {
    const config = getLinearConfig();
    if (config.authMode && config.authMode !== 'personal_api_key') {
      throw new Error(
        `Auth mode "${config.authMode}" requires getLinearClientAsync(). ` +
          `Use personal_api_key or call the async variant.`,
      );
    }
    throw new Error('Linear API key not configured');
  }
  if (!linearClient || linearClientApiKey !== key) {
    linearClient = new LinearClient({ apiKey: key });
    linearClientApiKey = key;
  }
  return linearClient;
}

/** Create an ephemeral client for testing — does NOT mutate global state */
export function createTestClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}

let asyncLinearClient: LinearClient | null = null;
let asyncTokenExpiresAt = 0;

/**
 * Get a Linear client using any auth mode (personal_api_key, client_credentials, oauth2).
 * Superset of getLinearClient() — handles all auth modes including token-based.
 */
export async function getLinearClientAsync(): Promise<LinearClient> {
  const config = getLinearConfig();
  if (!config.authMode || config.authMode === 'personal_api_key') {
    return getLinearClient(config.apiKey || undefined);
  }
  // Reuse cached client if token still valid
  if (asyncLinearClient && Date.now() < asyncTokenExpiresAt) {
    return asyncLinearClient;
  }
  const token = await getLinearAccessToken({
    authMode: config.authMode,
    apiKey: config.apiKey,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  // LinearClient accepts `apiKey` for both API keys and OAuth access tokens
  asyncLinearClient = new LinearClient({ apiKey: token });
  // Cache for 25 min (conservative; getLinearAccessToken has 1hr buffer on its own cache)
  asyncTokenExpiresAt = Date.now() + 25 * 60 * 1000;
  return asyncLinearClient;
}

/** Invalidate both sync and async client caches (call on config change or 401 error). */
export function invalidateLinearClientCache(): void {
  linearClient = null;
  linearClientApiKey = null;
  asyncLinearClient = null;
  asyncTokenExpiresAt = 0;
  invalidateLinearToken();
}

/** Initialize or get LinearWebhookClient for signature verification */
export function getWebhookClient(secret: string): LinearWebhookClient {
  if (!webhookClient || webhookClientSecret !== secret) {
    webhookClient = new LinearWebhookClient(secret);
    webhookClientSecret = secret;
  }
  return webhookClient;
}

// Re-export SDK constants for use in routes
export { LINEAR_WEBHOOK_SIGNATURE_HEADER, LINEAR_WEBHOOK_TS_FIELD };

// ============================================================================
// Issue operations
// ============================================================================

/** Fetch full issue details via SDK */
export async function getIssueDetails(issueId: string): Promise<LinearIssue> {
  const client = getLinearClient();
  const issue = await client.issue(issueId);

  // Parallelize relation fetches (async-parallel best practice)
  const [state, team, assignee, labels] = await Promise.all([
    issue.state,
    issue.team,
    issue.assignee,
    issue.labels(),
  ]);

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority,
    labels: labels.nodes.map((l) => l.name),
    state: state ? { id: state.id, name: state.name } : { id: '', name: '' },
    team: team ? { id: team.id, key: team.key } : { id: '', key: '' },
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    url: issue.url,
    updatedAt: issue.updatedAt.toISOString(),
  };
}

/** Classify issue type from labels/title */
export function triageIssue(issue: LinearIssue): TicketClassification {
  const labelsLower = issue.labels.map((l) => l.toLowerCase());
  const titleLower = issue.title.toLowerCase();

  let type: TicketClassification['type'] = 'feature';
  let branchPrefix = 'feature/';

  // Check labels first
  if (labelsLower.some((l) => l.includes('bug'))) {
    type = 'bug';
    branchPrefix = 'fix/';
  } else if (labelsLower.some((l) => l.includes('chore'))) {
    type = 'chore';
    branchPrefix = 'chore/';
  } else if (labelsLower.some((l) => l.includes('refactor'))) {
    type = 'refactor';
    branchPrefix = 'refactor/';
  } else if (labelsLower.some((l) => l.includes('feature'))) {
    type = 'feature';
    branchPrefix = 'feature/';
  } else if (titleLower.startsWith('fix:') || titleLower.startsWith('fix ')) {
    type = 'bug';
    branchPrefix = 'fix/';
  } else if (titleLower.startsWith('feat:') || titleLower.startsWith('feat ')) {
    type = 'feature';
    branchPrefix = 'feature/';
  } else if (
    titleLower.startsWith('chore:') ||
    titleLower.startsWith('chore ')
  ) {
    type = 'chore';
    branchPrefix = 'chore/';
  } else if (
    titleLower.startsWith('refactor:') ||
    titleLower.startsWith('refactor ')
  ) {
    type = 'refactor';
    branchPrefix = 'refactor/';
  }

  // Generate branch slug from title
  const scope = issue.title
    .toLowerCase()
    .replace(/^(fix|feat|chore|refactor)[:\s]+/i, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  return {
    type,
    branchPrefix,
    priority: issue.priority,
    scope,
  };
}

/** Update issue workflow state */
export async function updateIssueState(
  issueId: string,
  stateId: string,
): Promise<void> {
  const client = getLinearClient();
  await client.updateIssue(issueId, { stateId });
  logger.info(`Updated issue ${issueId} to state ${stateId}`);
}

/** Post comment on issue */
export async function addIssueComment(
  issueId: string,
  body: string,
): Promise<void> {
  const client = getLinearClient();
  await client.createComment({ issueId, body: normalizeMarkdown(body) });
  logger.info(`Posted comment on issue ${issueId}`);
}

/** Get team workflow states */
export async function getTeamStates(teamId: string): Promise<WorkflowState[]> {
  const client = getLinearClient();
  const team = await client.team(teamId);
  const states = await team.states();
  return states.nodes.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
  }));
}

/** Get assigned issues (for polling). Uses cursor-based pagination. */
export async function getAssignedIssues(
  userId: string,
): Promise<LinearIssue[]> {
  const client = getLinearClient();
  const issues = await client.issues({
    filter: {
      assignee: { id: { eq: userId } },
    },
    first: 50,
  });

  // Parallelize per-issue relation fetches (async-parallel best practice)
  const results = await Promise.all(
    issues.nodes.map(async (issue) => {
      const [state, team, assignee, labels] = await Promise.all([
        issue.state,
        issue.team,
        issue.assignee,
        issue.labels(),
      ]);

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? null,
        priority: issue.priority,
        labels: labels.nodes.map((l) => l.name),
        state: state
          ? { id: state.id, name: state.name }
          : { id: '', name: '' },
        team: team ? { id: team.id, key: team.key } : { id: '', key: '' },
        assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
        url: issue.url,
        updatedAt: issue.updatedAt.toISOString(),
      };
    }),
  );

  return results;
}

// ============================================================================
// Viewer
// ============================================================================

/** Get the currently authenticated user */
export async function getViewer(): Promise<{
  id: string;
  name: string;
  email: string;
  displayName: string;
}> {
  const client = getLinearClient();
  const user = await client.viewer;
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? '',
    displayName: user.displayName,
  };
}

// ============================================================================
// Search
// ============================================================================

/** Full-text search across issues */
export async function searchIssues(
  term: string,
  limit: number = 20,
): Promise<LinearIssue[]> {
  const client = getLinearClient();
  const result = await client.searchIssues(term, { first: limit });

  return Promise.all(
    result.nodes.map(async (issue) => {
      // IssueSearchResult has labelIds but no labels() method — fetch full issue for label names
      return getIssueDetails(issue.id);
    }),
  );
}

// ============================================================================
// Issue CRUD
// ============================================================================

/**
 * Normalize markdown text for Linear API.
 * AI models sometimes output literal \n sequences instead of real newlines.
 */
function normalizeMarkdown(text: string): string {
  return text.replace(/\\n/g, '\n');
}

/** Create a new issue */
export async function createIssue(input: {
  teamId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  stateId?: string;
  priority?: number;
  estimate?: number;
  labelIds?: string[];
  projectId?: string;
  cycleId?: string;
  parentId?: string;
  dueDate?: string;
}): Promise<LinearIssue> {
  const client = getLinearClient();
  const normalized = {
    ...input,
    ...(input.description && {
      description: normalizeMarkdown(input.description),
    }),
  };
  const payload = await client.createIssue(normalized);
  const issue = await payload.issue;
  if (!issue) throw new Error('Failed to create issue');

  const [state, team, assignee, labels] = await Promise.all([
    issue.state,
    issue.team,
    issue.assignee,
    issue.labels(),
  ]);

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    priority: issue.priority,
    labels: labels.nodes.map((l) => l.name),
    state: state ? { id: state.id, name: state.name } : { id: '', name: '' },
    team: team ? { id: team.id, key: team.key } : { id: '', key: '' },
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    url: issue.url,
    updatedAt: issue.updatedAt.toISOString(),
  };
}

/** Update any fields on an issue */
export async function updateIssueFields(
  issueId: string,
  fields: {
    title?: string;
    description?: string;
    stateId?: string;
    assigneeId?: string;
    priority?: number;
    estimate?: number;
    projectId?: string;
    cycleId?: string;
    parentId?: string;
    dueDate?: string;
    labelIds?: string[];
  },
): Promise<void> {
  const client = getLinearClient();
  await client.updateIssue(issueId, fields);
  logger.info(
    `Updated issue ${issueId} fields: ${Object.keys(fields).join(', ')}`,
  );
}

/** Archive/delete an issue */
export async function deleteIssue(issueId: string): Promise<void> {
  const client = getLinearClient();
  await client.archiveIssue(issueId);
  logger.info(`Archived issue ${issueId}`);
}

// ============================================================================
// Comments
// ============================================================================

/** Get comments on an issue */
export async function getIssueComments(
  issueId: string,
): Promise<{ id: string; body: string; user: string; createdAt: string }[]> {
  const client = getLinearClient();
  const issue = await client.issue(issueId);
  const comments = await issue.comments();

  return Promise.all(
    comments.nodes.map(async (c) => {
      const user = await c.user;
      return {
        id: c.id,
        body: c.body,
        user: user?.name ?? 'Unknown',
        createdAt: c.createdAt.toISOString(),
      };
    }),
  );
}

// ============================================================================
// Relations
// ============================================================================

/** Get issue relations, parent, and children */
export interface RelatedIssueRef {
  id: string;
  identifier: string;
  title: string;
  /** Linear web URL — clickable in chat/web channels. */
  url: string;
}

export async function getIssueRelations(issueId: string): Promise<{
  relations: {
    id: string;
    type: string;
    relatedIssue: RelatedIssueRef;
  }[];
  parent: RelatedIssueRef | null;
  children: RelatedIssueRef[];
}> {
  const client = getLinearClient();
  const issue = await client.issue(issueId);

  const [relations, parent, children] = await Promise.all([
    issue.relations(),
    issue.parent,
    issue.children(),
  ]);

  const resolvedRelations = (
    await Promise.all(
      relations.nodes.map(async (r) => {
        const related = await r.relatedIssue;
        if (!related) return null;
        return {
          id: r.id,
          type: r.type,
          relatedIssue: {
            id: related.id,
            identifier: related.identifier,
            title: related.title,
            url: related.url,
          },
        };
      }),
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  return {
    relations: resolvedRelations,
    parent: parent
      ? {
          id: parent.id,
          identifier: parent.identifier,
          title: parent.title,
          url: parent.url,
        }
      : null,
    children: children.nodes.map((c) => ({
      id: c.id,
      identifier: c.identifier,
      title: c.title,
      url: c.url,
    })),
  };
}

// ============================================================================
// Attachments
// ============================================================================

export interface IssueAttachmentMeta {
  id: string;
  title: string;
  url: string;
  source?: string;
  createdAt: string;
}

/** Get attachment metadata for an issue (no bytes downloaded) */
export async function getIssueAttachments(
  issueId: string,
  limit = 20,
): Promise<IssueAttachmentMeta[]> {
  const client = getLinearClient();
  const issue = await client.issue(issueId);
  const attachments = await issue.attachments({ first: limit });

  return attachments.nodes.slice(0, limit).map((a) => {
    const sourceType =
      typeof a.sourceType === 'string' ? a.sourceType : undefined;
    return {
      id: a.id,
      title: a.title ?? 'Untitled',
      url: a.url,
      ...(sourceType ? { source: sourceType } : {}),
      createdAt: a.createdAt.toISOString(),
    };
  });
}

const RELATION_TYPE_MAP: Record<string, IssueRelationType> = {
  blocks: IssueRelationType.Blocks,
  duplicate: IssueRelationType.Duplicate,
  related: IssueRelationType.Related,
};

/** Create a relation between two issues */
export async function createIssueRelation(
  issueId: string,
  relatedIssueId: string,
  type: 'blocks' | 'duplicate' | 'related',
): Promise<void> {
  const client = getLinearClient();
  await client.createIssueRelation({
    issueId,
    relatedIssueId,
    type: RELATION_TYPE_MAP[type]!,
  });
  logger.info(`Created ${type} relation: ${issueId} → ${relatedIssueId}`);
}

// ============================================================================
// Organization discovery
// ============================================================================

/** List all teams with their workflow states */
export async function getTeams(): Promise<
  { id: string; name: string; key: string; states: WorkflowState[] }[]
> {
  const client = getLinearClient();
  const teams = await client.teams();

  return Promise.all(
    teams.nodes.map(async (t) => {
      const states = await t.states();
      return {
        id: t.id,
        name: t.name,
        key: t.key,
        states: states.nodes.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
        })),
      };
    }),
  );
}

/** List workspace users */
export async function getUsers(
  teamId?: string,
): Promise<{ id: string; name: string; email: string; displayName: string }[]> {
  const client = getLinearClient();
  if (teamId) {
    const team = await client.team(teamId);
    const members = await team.members();
    return members.nodes.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email ?? '',
      displayName: u.displayName,
    }));
  }
  const users = await client.users();
  return users.nodes.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email ?? '',
    displayName: u.displayName,
  }));
}

/** List projects */
export async function getProjects(
  teamId?: string,
  status?: string,
): Promise<{ id: string; name: string; state: string; url: string }[]> {
  const client = getLinearClient();
  const projects = await client.projects({
    ...(status ? { filter: { state: { eq: status } } } : {}),
  });

  if (teamId) {
    // Filter projects by team membership
    const filtered = await Promise.all(
      projects.nodes.map(async (p) => {
        const teams = await p.teams();
        const hasTeam = teams.nodes.some((t) => t.id === teamId);
        return hasTeam
          ? { id: p.id, name: p.name, state: p.state, url: p.url }
          : null;
      }),
    );
    return filtered.filter((p): p is NonNullable<typeof p> => p !== null);
  }

  return projects.nodes.map((p) => ({
    id: p.id,
    name: p.name,
    state: p.state,
    url: p.url,
  }));
}

/** List cycles/sprints */
export async function getCycles(
  teamId?: string,
  activeOnly?: boolean,
): Promise<
  {
    id: string;
    name: string | null;
    number: number;
    startsAt: string;
    endsAt: string;
    isActive: boolean;
  }[]
> {
  const client = getLinearClient();
  const mapCycle = (c: {
    id: string;
    name?: string | null;
    number: number;
    startsAt: Date;
    endsAt: Date;
  }) => ({
    id: c.id,
    name: c.name ?? null,
    number: c.number,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    isActive: new Date() >= c.startsAt && new Date() <= c.endsAt,
  });

  if (teamId) {
    const team = await client.team(teamId);
    const cycles = await team.cycles();
    const results = cycles.nodes.map(mapCycle);
    return activeOnly ? results.filter((c) => c.isActive) : results;
  }
  const cycles = await client.cycles();
  const results = cycles.nodes.map(mapCycle);
  return activeOnly ? results.filter((c) => c.isActive) : results;
}

// ============================================================================
// Labels
// ============================================================================

/** List issue labels */
export async function getLabels(
  teamId?: string,
): Promise<{ id: string; name: string; color: string }[]> {
  const client = getLinearClient();
  if (teamId) {
    const team = await client.team(teamId);
    const labels = await team.labels();
    return labels.nodes.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
    }));
  }
  const labels = await client.issueLabels();
  return labels.nodes.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
  }));
}

/** Create a new label */
export async function createLabel(
  name: string,
  teamId?: string,
  color?: string,
): Promise<{ id: string; name: string; color: string }> {
  const client = getLinearClient();
  const payload = await client.createIssueLabel({
    name,
    ...(teamId ? { teamId } : {}),
    ...(color ? { color } : {}),
  });
  const label = await payload.issueLabel;
  if (!label) throw new Error('Failed to create label');
  return { id: label.id, name: label.name, color: label.color };
}

/** Add a label to an issue */
export async function addLabelToIssue(
  issueId: string,
  labelId: string,
): Promise<void> {
  const client = getLinearClient();
  await client.issueAddLabel(issueId, labelId);
  logger.info(`Added label ${labelId} to issue ${issueId}`);
}

/** Remove a label from an issue */
export async function removeLabelFromIssue(
  issueId: string,
  labelId: string,
): Promise<void> {
  const client = getLinearClient();
  await client.issueRemoveLabel(issueId, labelId);
  logger.info(`Removed label ${labelId} from issue ${issueId}`);
}

// ============================================================================
// Attachments
// ============================================================================

// ============================================================================
// File Upload
// ============================================================================

export interface FileUploadResult {
  /** URL to the uploaded file on Linear's cloud storage */
  assetUrl: string;
  /** Markdown to embed this file in an issue/comment */
  markdown: string;
}

/**
 * Upload a file to Linear's cloud storage via the fileUpload mutation.
 *
 * Flow: SDK.fileUpload() → presigned URL + headers → server-side PUT → assetUrl
 *
 * Supports images, PDFs, logs, videos, and any other file type.
 * The returned assetUrl can be embedded in issue descriptions/comments via markdown.
 *
 * @see https://linear.app/developers/how-to-upload-a-file-to-linear
 */
export async function uploadFileToLinear(
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
): Promise<FileUploadResult> {
  const client = getLinearClient();

  // Step 1: Request presigned upload URL from Linear
  const uploadPayload = await client.fileUpload(
    contentType,
    filename,
    fileBuffer.byteLength,
  );

  if (!uploadPayload.success || !uploadPayload.uploadFile) {
    throw new Error(
      'Linear fileUpload mutation failed: no upload URL returned',
    );
  }

  const {
    uploadUrl,
    assetUrl,
    headers: uploadHeaders,
  } = uploadPayload.uploadFile;

  // Step 2: PUT the file to the presigned URL (must be server-side — CSP blocks client)
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000',
  };
  for (const { key, value } of uploadHeaders) {
    headers[key] = value;
  }

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body: new Uint8Array(fileBuffer),
    signal: AbortSignal.timeout(60_000),
  });

  if (!putResponse.ok) {
    const body = await putResponse.text().catch(() => '');
    throw new Error(
      `Failed to upload file to Linear storage: HTTP ${putResponse.status} ${body}`,
    );
  }

  logger.info(
    `File uploaded to Linear: ${filename} (${fileBuffer.byteLength} bytes)`,
  );

  // Step 3: Build markdown for embedding
  const isImage = contentType.startsWith('image/');
  const markdown = isImage
    ? `![${filename}](${assetUrl})`
    : `[${filename}](${assetUrl})`;

  return { assetUrl, markdown };
}

/**
 * Upload a file and attach it to an issue by appending to a comment.
 * Combines upload + comment in one call for convenience.
 */
export async function uploadAndAttachToIssue(
  issueId: string,
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
  caption?: string,
): Promise<FileUploadResult> {
  const result = await uploadFileToLinear(fileBuffer, filename, contentType);

  const commentBody = caption
    ? `${caption}\n\n${result.markdown}`
    : result.markdown;
  await addIssueComment(issueId, commentBody);

  return result;
}

/** Create an attachment (link a URL to an issue). URL is idempotent per issue. */
export async function createAttachment(
  issueId: string,
  url: string,
  title: string,
  opts?: {
    subtitle?: string;
    metadata?: Record<string, unknown>;
    iconUrl?: string;
  },
): Promise<void> {
  const client = getLinearClient();
  await client.createAttachment({
    issueId,
    url,
    title,
    ...(opts?.subtitle ? { subtitle: opts.subtitle } : {}),
    ...(opts?.metadata ? { metadata: opts.metadata } : {}),
    ...(opts?.iconUrl ? { iconUrl: opts.iconUrl } : {}),
  });
  logger.info(`Created attachment on issue ${issueId}: ${url}`);
}

/**
 * Ensure issue is assigned to the agent. If unassigned or assigned to someone else,
 * self-assigns using the configured agentUserId (or resolves via getViewer()).
 *
 * Returns the agent's user ID for downstream use.
 */
export async function ensureAssignedToAgent(
  issue: LinearIssue,
  config: { agentUserId?: string },
): Promise<string> {
  let agentId = config.agentUserId;

  // Resolve agent ID if not configured
  if (!agentId) {
    const viewer = await getViewer();
    agentId = viewer.id;
  }

  // Already assigned to agent — no action needed
  if (issue.assignee?.id === agentId) {
    return agentId;
  }

  // Self-assign
  await updateIssueFields(issue.id, { assigneeId: agentId });
  logger.info(
    `Self-assigned ${issue.identifier} to agent ${agentId}` +
      (issue.assignee
        ? ` (was: ${issue.assignee.name})`
        : ' (was: unassigned)'),
  );
  return agentId;
}

// ============================================================================
// Polling service
// ============================================================================

let pollInterval: NodeJS.Timeout | null = null;
let lastPollTime = new Date();
const pollLogger = createLogger('LinearPoller');

/** Start polling on interval. Dev-only fallback — webhooks are preferred. */
export function startPolling(config: LinearConfig): void {
  if (pollInterval) return;
  pollLogger.info(
    `Starting poller (interval: ${config.pollIntervalMs}ms). Note: polling is a dev-only fallback; use webhooks in production.`,
  );
  // Initialize client with API key from config
  getLinearClient(config.apiKey);
  pollInterval = setInterval(
    () => pollForIssues(config),
    config.pollIntervalMs,
  );
}

/** Stop polling */
export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    pollLogger.info('Poller stopped');
  }
}

/** Check if poller is currently running */
export function isPolling(): boolean {
  return pollInterval !== null;
}

async function pollForIssues(config: LinearConfig): Promise<void> {
  try {
    const agentId = config.agentUserId || config.assigneeFilter;
    if (!agentId) {
      pollLogger.warn(
        'No agentUserId or assigneeFilter configured — skipping poll',
      );
      return;
    }
    const issues = await getAssignedIssues(agentId);
    const newIssues = issues.filter(
      (i) => new Date(i.updatedAt) > lastPollTime,
    );
    lastPollTime = new Date();
    for (const issue of newIssues) {
      await enqueue(issue);
    }
    if (newIssues.length > 0) {
      pollLogger.info(`Found ${newIssues.length} new issue(s)`);
    }
  } catch (err) {
    pollLogger.error('Poll failed:', err);
  }
}
