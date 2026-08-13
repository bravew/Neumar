/**
 * Pipeline Web Research
 *
 * Conducts web research before the planning phase to gather
 * best practices for the detected tech stack. Results are injected
 * into the planner's prompt and cached as semantic memories.
 *
 * Uses the existing search router which supports 13 providers
 * (Tavily, Brave, Serper, DuckDuckGo, etc.).
 */

import { createLogger } from '@/shared/utils/logger';

import { search } from '../search/router';
import type { RepoContext } from './prompts';

const logger = createLogger('PipelineResearch');

// ============================================================================
// Types
// ============================================================================

export interface ResearchFindings {
  /** High-level best practices extracted from search results */
  bestPractices: string[];
  /** Relevant documentation links with snippets */
  relevantDocs: Array<{ title: string; url: string; snippet: string }>;
  /** Detected tech stack components */
  techStack: string[];
  /** Search queries that were executed */
  searchQueries: string[];
  /** Total time spent researching (ms) */
  totalLatencyMs: number;
}

interface IssueLike {
  identifier: string;
  title: string;
  description: string | null;
  labels: string[];
}

type RepoContextLike = Pick<
  RepoContext,
  'packageJsonScripts' | 'directoryStructure' | 'packageManager'
>;

// ============================================================================
// Tech stack detection
// ============================================================================

/** Well-known framework/library indicators in package.json scripts and directory structure. */
const TECH_INDICATORS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bnext\b/i, name: 'Next.js' },
  { pattern: /\breact\b/i, name: 'React' },
  { pattern: /\bvue\b/i, name: 'Vue' },
  { pattern: /\bangular\b/i, name: 'Angular' },
  { pattern: /\bsvelte\b/i, name: 'Svelte' },
  { pattern: /\bhono\b/i, name: 'Hono' },
  { pattern: /\bexpress\b/i, name: 'Express' },
  { pattern: /\bfastify\b/i, name: 'Fastify' },
  { pattern: /\btailwind\b/i, name: 'Tailwind CSS' },
  { pattern: /\bprisma\b/i, name: 'Prisma' },
  { pattern: /\bdrizzle\b/i, name: 'Drizzle' },
  { pattern: /\btauri\b/i, name: 'Tauri' },
  { pattern: /\belectron\b/i, name: 'Electron' },
  { pattern: /\bvitest\b/i, name: 'Vitest' },
  { pattern: /\bjest\b/i, name: 'Jest' },
  { pattern: /\bplaywright\b/i, name: 'Playwright' },
  { pattern: /\btsc\b|typescript/i, name: 'TypeScript' },
  { pattern: /\bvite\b/i, name: 'Vite' },
  { pattern: /\besbuild\b/i, name: 'esbuild' },
  { pattern: /\bpython\b|\.py\b/i, name: 'Python' },
  { pattern: /\brust\b|cargo/i, name: 'Rust' },
  { pattern: /\bgo\b|\.go\b/i, name: 'Go' },
];

/**
 * Detect tech stack from repo context.
 */
export function detectTechStack(repoCtx: RepoContextLike): string[] {
  const combined =
    Object.keys(repoCtx.packageJsonScripts).join(' ') +
    ' ' +
    Object.values(repoCtx.packageJsonScripts).join(' ') +
    ' ' +
    repoCtx.directoryStructure;

  const detected = new Set<string>();
  for (const { pattern, name } of TECH_INDICATORS) {
    if (pattern.test(combined)) {
      detected.add(name);
    }
  }
  return Array.from(detected);
}

// ============================================================================
// Research
// ============================================================================

/** Max total tokens for research findings (keeps context lean). */
const MAX_RESEARCH_CHARS = 3000;

/**
 * Build search queries based on issue and tech stack.
 */
function buildSearchQueries(
  issue: IssueLike,
  techStack: string[],
  issueType: string,
): string[] {
  const queries: string[] = [];

  // Primary query: tech stack + issue type
  if (techStack.length > 0) {
    const stackStr = techStack.slice(0, 3).join(' ');
    queries.push(
      `${stackStr} ${issueType} best practices ${new Date().getFullYear()}`,
    );
  }

  // Secondary query: specific to issue title keywords
  const titleKeywords = issue.title
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
    .join(' ');
  if (titleKeywords && techStack.length > 0) {
    queries.push(`${techStack[0]} ${titleKeywords}`);
  }

  return queries.slice(0, 3); // Max 3 queries
}

/** Map triageIssue classification types to search-friendly terms. */
const ISSUE_TYPE_LABELS: Record<string, string> = {
  bug: 'bug fix',
  feature: 'feature implementation',
  refactor: 'refactoring',
  chore: 'infrastructure',
};

/**
 * Classify issue type using the existing triageIssue() from linear.ts,
 * mapping to human-readable search query terms.
 */
function classifyIssueType(issue: IssueLike): string {
  // Reuse existing classification logic via label/title heuristics
  // (triageIssue requires full LinearIssue, so we inline a lightweight version)
  const labels = issue.labels.map((l) => l.toLowerCase());
  if (labels.some((l) => l.includes('bug') || l.includes('fix')))
    return ISSUE_TYPE_LABELS['bug']!;
  if (labels.some((l) => l.includes('feature') || l.includes('enhancement')))
    return ISSUE_TYPE_LABELS['feature']!;
  if (labels.some((l) => l.includes('refactor')))
    return ISSUE_TYPE_LABELS['refactor']!;
  if (labels.some((l) => l.includes('chore') || l.includes('infra')))
    return ISSUE_TYPE_LABELS['chore']!;

  const title = issue.title.toLowerCase();
  if (title.includes('fix') || title.includes('bug'))
    return ISSUE_TYPE_LABELS['bug']!;
  if (title.includes('refactor')) return ISSUE_TYPE_LABELS['refactor']!;
  return ISSUE_TYPE_LABELS['feature']!;
}

/**
 * Conduct web research for the issue's tech stack and type.
 * Returns best practices and relevant documentation links.
 *
 * Gracefully returns empty results if search is not configured.
 */
export async function conductResearch(
  issue: IssueLike,
  repoCtx: RepoContextLike,
  signal?: AbortSignal,
): Promise<ResearchFindings> {
  const techStack = detectTechStack(repoCtx);
  const issueType = classifyIssueType(issue);
  const queries = buildSearchQueries(issue, techStack, issueType);

  const findings: ResearchFindings = {
    bestPractices: [],
    relevantDocs: [],
    techStack,
    searchQueries: queries,
    totalLatencyMs: 0,
  };

  if (queries.length === 0 || techStack.length === 0) {
    logger.info(
      'Skipping research: no tech stack detected or no queries built',
    );
    return findings;
  }

  let totalChars = 0;

  for (const query of queries) {
    if (signal?.aborted) break;
    if (totalChars >= MAX_RESEARCH_CHARS) break;

    try {
      const response = await search({
        query,
        maxResults: 3,
        freshness: 'year',
        type: 'web',
      });

      findings.totalLatencyMs += response.latencyMs;

      for (const result of response.results) {
        if (totalChars >= MAX_RESEARCH_CHARS) break;

        const snippet = result.snippet || result.content?.slice(0, 200) || '';
        if (!snippet) continue;

        findings.relevantDocs.push({
          title: result.title,
          url: result.url,
          snippet: snippet.slice(0, 200),
        });

        // Extract a best practice from the snippet
        if (snippet.length > 30) {
          findings.bestPractices.push(snippet.slice(0, 150));
          totalChars += snippet.length;
        }
      }

      // Use AI-generated answer if available (Tavily, Perplexity)
      if (response.answer && totalChars < MAX_RESEARCH_CHARS) {
        findings.bestPractices.unshift(response.answer.slice(0, 300));
        totalChars += response.answer.length;
      }
    } catch (err) {
      logger.warn('Search query failed, continuing with remaining queries', {
        query,
        err,
      });
    }
  }

  // Deduplicate best practices
  findings.bestPractices = [...new Set(findings.bestPractices)].slice(0, 8);

  logger.info('Research complete', {
    issue: issue.identifier,
    techStack,
    queriesRun: queries.length,
    docsFound: findings.relevantDocs.length,
    practicesFound: findings.bestPractices.length,
    totalLatencyMs: findings.totalLatencyMs,
  });

  return findings;
}

/**
 * Format research findings as a prompt block for agent injection.
 * Returns empty string if no findings.
 */
export function formatResearchBlock(findings: ResearchFindings): string {
  if (
    findings.bestPractices.length === 0 &&
    findings.relevantDocs.length === 0
  ) {
    return '';
  }

  const lines: string[] = [
    '## Research Findings',
    `Tech stack: ${findings.techStack.join(', ')}`,
    '',
  ];

  if (findings.bestPractices.length > 0) {
    lines.push('### Best Practices');
    for (const practice of findings.bestPractices) {
      lines.push(`- ${practice}`);
    }
    lines.push('');
  }

  if (findings.relevantDocs.length > 0) {
    lines.push('### Relevant Documentation');
    for (const doc of findings.relevantDocs.slice(0, 5)) {
      lines.push(`- [${doc.title}](${doc.url}): ${doc.snippet}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
