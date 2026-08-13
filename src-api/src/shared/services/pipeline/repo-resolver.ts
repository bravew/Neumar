/**
 * Repository Resolver
 *
 * Extracts GitHub repository information from Linear tickets.
 * Supports multiple resolution strategies with priority order.
 */

import type { LinearIssue } from '../linear';
import type { LinearConfig } from '../linear-config';
import type { RepoInfo, TicketContext } from './prompts';

export type RepoResolutionSource =
  | 'attachment'
  | 'description'
  | 'comment'
  | 'config';

export interface ResolvedRepo extends RepoInfo {
  resolvedVia: RepoResolutionSource;
}

// ============================================================================
// URL Parsing
// ============================================================================

/**
 * Extract GitHub repo URLs from any text.
 * Returns deduplicated list of {owner, repo, url}.
 *
 * Handles:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/branch
 * - https://github.com/owner/repo/issues/123
 * - Markdown links: [text](https://github.com/owner/repo)
 */
export function parseGitHubUrls(text: string): RepoInfo[] {
  if (!text) return [];

  const regex = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git|\/|$)/g;
  const found = new Map<string, RepoInfo>();

  let match;
  while ((match = regex.exec(text)) !== null) {
    const owner = match[1]!;
    const repo = match[2]!.replace(/\.git$/, '');
    const key = `${owner}/${repo}`;

    if (!found.has(key)) {
      found.set(key, {
        owner,
        repo,
        url: `https://github.com/${owner}/${repo}`,
      });
    }
  }

  return Array.from(found.values());
}

// ============================================================================
// Repository Resolution
// ============================================================================

/**
 * Resolve target repo from ticket context.
 *
 * Priority order:
 * 1. Attachments (highest authority — explicit link)
 * 2. Description (embedded links)
 * 3. Comments (mentioned repos)
 * 4. Config repoMappings (team ID + label pattern matching)
 *
 * Returns the resolved repo with its resolution source, or null.
 */
export function resolveRepoFromTicket(
  issue: LinearIssue,
  ticketCtx: TicketContext | undefined,
  config: LinearConfig,
): ResolvedRepo | null {
  return resolveAllReposFromTicket(issue, ticketCtx, config)[0] ?? null;
}

/**
 * Resolve ALL target repos from ticket context (for multi-repo decomposition).
 * Returns deduplicated array of repos found across all sources, each tagged with resolvedVia.
 * Capped at 5 repos to prevent runaway decomposition.
 */
export function resolveAllReposFromTicket(
  issue: LinearIssue,
  ticketCtx: TicketContext | undefined,
  config: LinearConfig,
): ResolvedRepo[] {
  const found = new Map<string, ResolvedRepo>();

  const addRepo = (info: RepoInfo, source: RepoResolutionSource) => {
    const key = `${info.owner}/${info.repo}`;
    if (!found.has(key)) found.set(key, { ...info, resolvedVia: source });
  };

  // Attachments (highest authority)
  if (ticketCtx?.attachments) {
    for (const attachment of ticketCtx.attachments) {
      parseGitHubUrls(attachment.url).forEach((r) => addRepo(r, 'attachment'));
    }
  }

  // Description
  parseGitHubUrls(issue.description || '').forEach((r) =>
    addRepo(r, 'description'),
  );

  // Comments
  if (ticketCtx?.comments) {
    for (const comment of ticketCtx.comments) {
      parseGitHubUrls(comment.body).forEach((r) => addRepo(r, 'comment'));
    }
  }

  // Config repoMappings (all matching, not just first)
  if (config.repoMappings.length > 0) {
    for (const mapping of config.repoMappings) {
      const teamMatch = !mapping.teamId || mapping.teamId === issue.team?.id;
      const labelMatch =
        !mapping.labelPattern ||
        issue.labels.some((l) =>
          l.toLowerCase().includes(mapping.labelPattern!.toLowerCase()),
        );
      if (teamMatch && labelMatch) {
        addRepo(
          {
            owner: mapping.owner,
            repo: mapping.repo,
            url: `https://github.com/${mapping.owner}/${mapping.repo}`,
          },
          'config',
        );
      }
    }
  }

  // Cap at 5 to prevent runaway decomposition
  return Array.from(found.values()).slice(0, 5);
}
