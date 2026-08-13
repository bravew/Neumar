/**
 * Linear MCP Server
 *
 * Provides Linear issue management tools for AI agents.
 * Uses the existing @linear/sdk integration from linear.ts
 * and config from linear-config.ts (AES-256-GCM encrypted PAT).
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  addIssueComment,
  addLabelToIssue,
  createAttachment,
  createIssue,
  createIssueRelation,
  createLabel,
  deleteIssue,
  getAssignedIssues,
  getCycles,
  getIssueComments,
  getIssueDetails,
  getIssueRelations,
  getLabels,
  getLinearClient,
  getProjects,
  getTeams,
  getUsers,
  getViewer,
  removeLabelFromIssue,
  searchIssues,
  updateIssueFields,
  uploadAndAttachToIssue,
  type LinearIssue,
} from '@/shared/services/linear';
import { getLinearConfig } from '@/shared/services/linear-config';
import { getRunEnv } from '@/shared/services/session-context';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Ensure a Linear client is available for the current turn. The per-user
 * PAT in `SessionContext.userCredentials.LINEAR_API_KEY` (Slack App Home)
 * is preferred; the global admin-configured key is the fallback.
 */
function ensureClient(): void {
  // Per-turn key from SessionContext is read directly inside getLinearClient
  // (via getRunEnv) — no need to construct an ephemeral client here.
  if (getRunEnv('LINEAR_API_KEY')) return;
  const config = getLinearConfig();
  if (!config.apiKey) {
    throw new Error('Linear API key not configured');
  }
  getLinearClient(config.apiKey);
}

/** Guess MIME type from filename extension. */
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  zip: 'application/zip',
};

function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? `Priority ${priority}`;
}

function linkifyIssue(identifier: string, url: string): string {
  return `[${identifier}](${url})`;
}

function formatIssue(issue: LinearIssue): string {
  const lines = [
    `**${linkifyIssue(issue.identifier, issue.url)}** — ${issue.title}`,
    `  State: ${issue.state.name} · Priority: ${priorityLabel(issue.priority)} · Team: ${issue.team.key}`,
  ];
  const meta: string[] = [];
  if (issue.assignee) meta.push(`Assignee: ${issue.assignee.name}`);
  if (issue.labels.length > 0) meta.push(`Labels: ${issue.labels.join(', ')}`);
  if (meta.length > 0) lines.push(`  ${meta.join(' · ')}`);
  if (issue.description) {
    const desc =
      issue.description.length > 200
        ? issue.description.slice(0, 200) + '…'
        : issue.description;
    lines.push(`  Description: ${desc}`);
  }
  // Bare URL — Slack auto-unfurls Linear links into a rich card
  // (https://linear.app/docs/slack); markdown-styled links don't.
  lines.push(`  ${issue.url}`);
  return lines.join('\n');
}

const LINK_REMINDER =
  'When summarising in your reply, reproduce each issue identifier as a markdown link `[ABC-123](https://linear.app/...)` AND include the bare URL on its own line so Slack auto-unfurls it into a rich preview card. The bare URL is what triggers the Slack-Linear card with status, assignee, and inline action buttons.';

// ============================================================================
// Tool definitions
// ============================================================================

export const linearTools = [
  // ---- Issue Core (6) ----
  tool(
    'linear_get_issue',
    `Get a Linear issue by ID or identifier (e.g. "ENG-123"). Returns full issue details including state, labels, assignee, description, and a clickable URL.\n\n${LINK_REMINDER}`,
    {
      issueId: z.string().describe('Issue UUID or identifier (e.g. "ENG-123")'),
    },
    async ({ issueId }) => {
      try {
        ensureClient();
        const issue = await getIssueDetails(issueId);
        return {
          content: [
            {
              type: 'text' as const,
              text: formatIssue(issue),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_get_my_issues',
    `List issues assigned to the current user (or configured assignee filter). Returns the most recent issues with status, priority, and a clickable URL each.\n\n${LINK_REMINDER}`,
    {
      limit: z
        .number()
        .optional()
        .describe('Max issues to return (default 20)'),
    },
    async ({ limit }) => {
      try {
        ensureClient();
        const config = getLinearConfig();
        let userId = config.assigneeFilter;
        if (!userId) {
          const viewer = await getViewer();
          userId = viewer.id;
        }
        const issues = await getAssignedIssues(userId);
        const sliced = issues.slice(0, limit ?? 20);
        const text =
          sliced.length > 0
            ? sliced.map(formatIssue).join('\n\n---\n\n')
            : 'No issues assigned.';
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_search_issues',
    `Full-text search across all Linear issues. Returns matching issues with status, priority, and a clickable URL each.

Example usage:
- query: "login bug", limit: 10
- query: "assignee:alice high priority"

${LINK_REMINDER}`,
    {
      query: z.string().describe('Search query text'),
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ query: q, limit }) => {
      try {
        ensureClient();
        const issues = await searchIssues(q, limit ?? 20);
        const text =
          issues.length > 0
            ? issues.map(formatIssue).join('\n\n---\n\n')
            : `No issues found for "${q}".`;
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_create_issue',
    `Create a new Linear issue. teamId and title are required. All other fields are optional.

IMPORTANT: If you have images, screenshots, PDFs, logs, or other files to attach, you MUST call linear_upload_file AFTER creating the issue. This tool only creates the issue with text — it does NOT upload files. Markdown image syntax (![](url)) only works with publicly-accessible URLs.

Example usage:
- Title: "Fix login timeout", Priority: 2 (High)
- Title: "Add dark mode", Labels: ["ui", "enhancement"], Description: "Support system-level dark mode preference"

Returns the new issue's identifier and a clickable URL. ${LINK_REMINDER}`,
    {
      teamId: z
        .string()
        .optional()
        .describe('Team ID (uses configured team if omitted)'),
      title: z.string().describe('Issue title'),
      description: z
        .string()
        .optional()
        .describe('Issue description (markdown)'),
      assigneeId: z.string().optional().describe('Assignee user ID'),
      stateId: z.string().optional().describe('Workflow state ID'),
      priority: z
        .number()
        .optional()
        .describe('Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low'),
      estimate: z.number().optional().describe('Complexity estimate'),
      labelIds: z.array(z.string()).optional().describe('Label IDs to attach'),
      projectId: z.string().optional().describe('Project ID'),
      cycleId: z.string().optional().describe('Cycle/sprint ID'),
      parentId: z
        .string()
        .optional()
        .describe('Parent issue ID for sub-issues'),
      dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
    },
    async (args) => {
      try {
        ensureClient();
        const config = getLinearConfig();
        const teamId = args.teamId || config.teamId;
        if (!teamId) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: teamId is required. Provide it or configure a default team.',
              },
            ],
            isError: true,
          };
        }
        const issue = await createIssue({ ...args, teamId });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Issue created: ${formatIssue(issue)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_update_issue',
    `Update fields on an existing Linear issue. Only provided fields are changed — omit fields you do not want to update.

Example usage:
- Set priority: issueId: "ENG-123", priority: 1 (Urgent)
- Reassign + change state: issueId: "ENG-456", assigneeId: "user-id", stateId: "state-id"

Returns the refreshed issue including a clickable URL. ${LINK_REMINDER}`,
    {
      issueId: z.string().describe('Issue UUID or identifier (e.g. "ENG-123")'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description (markdown)'),
      stateId: z.string().optional().describe('Workflow state ID'),
      assigneeId: z.string().optional().describe('Assignee user ID'),
      priority: z
        .number()
        .optional()
        .describe('Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low'),
      estimate: z.number().optional().describe('Complexity estimate'),
      projectId: z.string().optional().describe('Project ID'),
      cycleId: z.string().optional().describe('Cycle/sprint ID'),
      parentId: z.string().optional().describe('Parent issue ID'),
      dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      labelIds: z
        .array(z.string())
        .optional()
        .describe('Replace all labels with these IDs'),
      addLabelId: z.string().optional().describe('Add a single label by ID'),
      removeLabelId: z
        .string()
        .optional()
        .describe('Remove a single label by ID'),
    },
    async ({ issueId, addLabelId, removeLabelId, ...fields }) => {
      try {
        ensureClient();
        // Handle bulk field update
        const updateFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined) updateFields[k] = v;
        }
        if (Object.keys(updateFields).length > 0) {
          await updateIssueFields(issueId, updateFields);
        }
        // Handle individual label add/remove
        if (addLabelId) await addLabelToIssue(issueId, addLabelId);
        if (removeLabelId) await removeLabelFromIssue(issueId, removeLabelId);

        const updated = await getIssueDetails(issueId);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Issue updated: ${formatIssue(updated)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_delete_issue',
    'Archive (delete) a Linear issue.',
    {
      issueId: z.string().describe('Issue UUID or identifier (e.g. "ENG-123")'),
    },
    async ({ issueId }) => {
      try {
        ensureClient();
        await deleteIssue(issueId);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Issue ${issueId} has been archived.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Comments (2) ----
  tool(
    'linear_add_comment',
    `Post a markdown comment on a Linear issue.
\nReturns JSON: { id, body, issue: { identifier } }`,
    {
      issueId: z.string().describe('Issue UUID or identifier'),
      body: z.string().describe('Comment body (markdown)'),
    },
    async ({ issueId, body }) => {
      try {
        ensureClient();
        await addIssueComment(issueId, body);
        return {
          content: [
            { type: 'text' as const, text: `Comment posted on ${issueId}.` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_get_comments',
    'Get all comments on a Linear issue.',
    {
      issueId: z.string().describe('Issue UUID or identifier'),
    },
    async ({ issueId }) => {
      try {
        ensureClient();
        const comments = await getIssueComments(issueId);
        if (comments.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: 'No comments on this issue.' },
            ],
          };
        }
        const text = comments
          .map((c) => `**${c.user}** (${c.createdAt}):\n${c.body}`)
          .join('\n\n---\n\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Relations & Dependencies (2) ----
  tool(
    'linear_get_issue_relations',
    `Get relations (blocks, blocked by, related, duplicate), parent issue, and sub-issues for an issue. Each related issue includes a clickable URL.\n\n${LINK_REMINDER}`,
    {
      issueId: z.string().describe('Issue UUID or identifier'),
    },
    async ({ issueId }) => {
      try {
        ensureClient();
        const result = await getIssueRelations(issueId);
        const lines: string[] = [];

        if (result.parent) {
          lines.push(
            `Parent: ${linkifyIssue(result.parent.identifier, result.parent.url)} — ${result.parent.title}`,
          );
        }
        if (result.children.length > 0) {
          lines.push('Sub-issues:');
          for (const c of result.children) {
            lines.push(`  - ${linkifyIssue(c.identifier, c.url)}: ${c.title}`);
          }
        }
        if (result.relations.length > 0) {
          lines.push('Relations:');
          for (const r of result.relations) {
            lines.push(
              `  - ${r.type}: ${linkifyIssue(r.relatedIssue.identifier, r.relatedIssue.url)} — ${r.relatedIssue.title}`,
            );
          }
        }

        const text =
          lines.length > 0 ? lines.join('\n') : 'No relations found.';
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_create_issue_relation',
    'Create a relation between two Linear issues.',
    {
      issueId: z.string().describe('Source issue UUID or identifier'),
      relatedIssueId: z.string().describe('Target issue UUID or identifier'),
      type: z
        .enum(['blocks', 'duplicate', 'related'])
        .describe('Relation type'),
    },
    async ({ issueId, relatedIssueId, type }) => {
      try {
        ensureClient();
        await createIssueRelation(issueId, relatedIssueId, type);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Relation created: ${issueId} ${type} ${relatedIssueId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Organization & Discovery (4) ----
  tool(
    'linear_get_teams',
    'List all Linear teams with their workflow states. Use this to discover team IDs and state IDs for creating/updating issues.',
    {},
    async () => {
      try {
        ensureClient();
        const teams = await getTeams();
        const text = teams
          .map((t) => {
            const states = t.states
              .map((s) => `    - ${s.name} (${s.type}): ${s.id}`)
              .join('\n');
            return `**${t.name}** (${t.key}) — ID: ${t.id}\n  States:\n${states}`;
          })
          .join('\n\n');
        return {
          content: [{ type: 'text' as const, text: text || 'No teams found.' }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_get_users',
    'List workspace users. Optionally filter by team. Use this to find user IDs for assignment.',
    {
      teamId: z.string().optional().describe('Filter by team ID'),
    },
    async ({ teamId }) => {
      try {
        ensureClient();
        const users = await getUsers(teamId);
        const text = users
          .map((u) => `${u.displayName} (${u.email}) — ID: ${u.id}`)
          .join('\n');
        return {
          content: [{ type: 'text' as const, text: text || 'No users found.' }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_get_projects',
    'List projects. Optionally filter by team and/or status.',
    {
      teamId: z.string().optional().describe('Filter by team ID'),
      status: z
        .string()
        .optional()
        .describe(
          'Filter by project status (e.g. "started", "planned", "completed")',
        ),
    },
    async ({ teamId, status }) => {
      try {
        ensureClient();
        const projects = await getProjects(teamId, status);
        const text = projects
          .map(
            (p) =>
              `[**${p.name}**](${p.url}) — ${p.state} · ID: ${p.id}\n  ${p.url}`,
          )
          .join('\n\n');
        return {
          content: [
            { type: 'text' as const, text: text || 'No projects found.' },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_get_cycles',
    'List cycles (sprints). Optionally filter by team and/or active status.',
    {
      teamId: z.string().optional().describe('Filter by team ID'),
      activeOnly: z
        .boolean()
        .optional()
        .describe('Only return currently active cycles'),
    },
    async ({ teamId, activeOnly }) => {
      try {
        ensureClient();
        const cycles = await getCycles(teamId, activeOnly);
        const text = cycles
          .map((c) => {
            const name = c.name ? `**${c.name}**` : `Cycle ${c.number}`;
            const active = c.isActive ? ' (ACTIVE)' : '';
            return `${name}${active} — ID: ${c.id}\n  ${c.startsAt} → ${c.endsAt}`;
          })
          .join('\n\n');
        return {
          content: [
            { type: 'text' as const, text: text || 'No cycles found.' },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Labels (2) ----
  tool(
    'linear_get_labels',
    'List available issue labels. Optionally filter by team.',
    {
      teamId: z.string().optional().describe('Filter by team ID'),
    },
    async ({ teamId }) => {
      try {
        ensureClient();
        const labels = await getLabels(teamId);
        const text = labels
          .map((l) => `${l.name} (${l.color}) — ID: ${l.id}`)
          .join('\n');
        return {
          content: [
            { type: 'text' as const, text: text || 'No labels found.' },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  tool(
    'linear_create_label',
    'Create a new issue label.',
    {
      name: z.string().describe('Label name'),
      teamId: z
        .string()
        .optional()
        .describe('Team ID (workspace-wide if omitted)'),
      color: z.string().optional().describe('Hex color (e.g. "#ff0000")'),
    },
    async ({ name, teamId, color }) => {
      try {
        ensureClient();
        const label = await createLabel(name, teamId, color);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Label created: ${label.name} (${label.color}) — ID: ${label.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- User Identity (1) ----
  tool(
    'linear_get_viewer',
    'Get the currently authenticated Linear user info.',
    {},
    async () => {
      try {
        ensureClient();
        const viewer = await getViewer();
        return {
          content: [
            {
              type: 'text' as const,
              text: `${viewer.displayName} (${viewer.email}) — ID: ${viewer.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Attachments (1) ----
  tool(
    'linear_create_attachment',
    'Link a URL (GitHub PR, document, etc.) to a Linear issue as an attachment.',
    {
      issueId: z.string().describe('Issue UUID or identifier'),
      url: z.string().describe('URL to attach'),
      title: z.string().describe('Attachment title'),
      subtitle: z.string().optional().describe('Attachment subtitle'),
    },
    async ({ issueId, url, title, subtitle }) => {
      try {
        ensureClient();
        await createAttachment(issueId, url, title, { subtitle });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Attachment "${title}" linked to ${issueId}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- File Upload (1) ----
  tool(
    'linear_upload_file',
    `Upload a file to Linear's cloud storage and attach it to an issue as a comment.

PREFERRED: Use filePath to upload a file from disk (images, PDFs, logs, videos, any file).
ALTERNATIVE: Use contentText for text content you've generated (logs, markdown, CSV).
FALLBACK: Use contentBase64 for binary content you have as base64.

The file is uploaded server-side to Linear's private CDN. The returned assetUrl is permanent.
The file will appear as an embedded image or download link in a comment on the issue.

Example: To attach a screenshot at /path/to/screenshot.png to issue NEU-7:
  { issueId: "NEU-7", filePath: "/path/to/screenshot.png", caption: "Current UI" }`,
    {
      issueId: z
        .string()
        .describe('Issue UUID or identifier (e.g., "NEU-7" or UUID)'),
      filePath: z
        .string()
        .optional()
        .describe(
          'Absolute path to a file on disk to upload. MIME type and filename are auto-detected. This is the easiest way to upload files.',
        ),
      filename: z
        .string()
        .optional()
        .describe(
          'Filename with extension (e.g., "screenshot.png"). Required if using contentBase64/contentText, auto-detected from filePath.',
        ),
      contentType: z
        .string()
        .optional()
        .describe(
          'MIME type (e.g., "image/png"). Auto-detected from filePath or filename if omitted.',
        ),
      contentBase64: z
        .string()
        .optional()
        .describe(
          'File content as base64 string (for binary data you already have)',
        ),
      contentText: z
        .string()
        .optional()
        .describe(
          'File content as plain text (for logs, markdown, CSV you generated)',
        ),
      caption: z
        .string()
        .optional()
        .describe('Optional caption to include with the file in the comment'),
    },
    async ({
      issueId,
      filePath,
      filename,
      contentType,
      contentBase64,
      contentText,
      caption,
    }) => {
      try {
        ensureClient();

        let fileBuffer: Buffer;
        let resolvedFilename: string;
        let resolvedContentType: string;

        if (filePath) {
          // Read file from disk — the most common path
          const fs = await import('fs/promises');
          const path = await import('path');

          try {
            fileBuffer = await fs.readFile(filePath);
          } catch (err) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Cannot read file at "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          }

          resolvedFilename = filename || path.basename(filePath);
          resolvedContentType = contentType || guessMimeType(resolvedFilename);
        } else if (contentBase64) {
          fileBuffer = Buffer.from(contentBase64, 'base64');
          resolvedFilename = filename || 'file';
          resolvedContentType = contentType || guessMimeType(resolvedFilename);
        } else if (contentText) {
          fileBuffer = Buffer.from(contentText, 'utf-8');
          resolvedFilename = filename || 'file.txt';
          resolvedContentType = contentType || guessMimeType(resolvedFilename);
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Provide filePath (preferred), contentBase64, or contentText.',
              },
            ],
            isError: true,
          };
        }

        const result = await uploadAndAttachToIssue(
          issueId,
          fileBuffer,
          resolvedFilename,
          resolvedContentType,
          caption,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `File "${resolvedFilename}" uploaded and attached to ${issueId}.`,
                `Asset URL: ${result.assetUrl}`,
                `Markdown: ${result.markdown}`,
              ].join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),
];

// ============================================================================
// Export
// ============================================================================

/** All Linear tool names for allowedTools registration */
export const LINEAR_TOOL_NAMES = linearTools.map((t) => t.name);

/** Create the Linear MCP server instance */
export function createLinearMcpServer() {
  return createSdkMcpServer({
    name: 'linear',
    version: '1.0.0',
    tools: linearTools,
  });
}
