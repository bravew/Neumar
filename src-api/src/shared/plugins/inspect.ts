/**
 * Pre-install plugin inspection.
 *
 * Fetches a catalog plugin's key files directly from its GitHub source (raw
 * URLs, no full download) so the detail dialog can show real skill and eval
 * info before install. Best-effort: any file that is missing or unreadable is
 * simply omitted. Only GitHub-backed sources are inspectable; others return an
 * empty inspection.
 */

import { NetworkPolicyDenied, safeFetch } from '@/shared/network-policy/fetch';
import { externalApiPolicy } from '@/shared/network-policy/schema';
import { parseMarkdownFrontmatter } from '@/shared/utils/frontmatter';
import { createLogger } from '@/shared/utils/logger';

import { resolvePluginFetchTarget, type CatalogSource } from './remote-install';

const logger = createLogger('PluginInspect');

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SKILLS = 12;

export interface InspectedSkill {
  name: string;
  description: string;
  path: string;
}

export interface InspectedEvals {
  count: number;
  cases: string[];
}

export interface PluginInspection {
  inspectable: boolean;
  skills: InspectedSkill[];
  evals?: InspectedEvals;
  readme?: string;
  /** Open Design `od` workflow metadata, when present. */
  workflow?: {
    mode?: string;
    scenario?: string;
    kind?: string;
    inputs?: string[];
    pipeline?: string[];
    capabilities?: string[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchRawText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, externalApiPolicy(), {
      method: 'GET',
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) return null;
    if (res.body.length > MAX_FILE_BYTES) return null;
    return res.body.toString('utf8');
  } catch (err) {
    if (!(err instanceof NetworkPolicyDenied)) {
      logger.debug(`inspect fetch failed: ${(err as Error).message}`);
    }
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const text = await fetchRawText(url);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Skill directories to probe for SKILL.md, derived from the manifest. */
export function skillDirsFromManifest(manifest: unknown): string[] {
  const dirs = new Set<string>(['.']);
  if (!isRecord(manifest)) return [...dirs];
  // Open Design: compat.agentSkills[].path points at each SKILL.md.
  const compat = isRecord(manifest.compat) ? manifest.compat : null;
  const agentSkills =
    compat && Array.isArray(compat.agentSkills) ? compat.agentSkills : [];
  for (const entry of agentSkills) {
    const path = isRecord(entry)
      ? typeof entry.path === 'string'
        ? entry.path
        : undefined
      : typeof entry === 'string'
        ? entry
        : undefined;
    if (path) {
      const dir = path.replace(/\/?SKILL\.md$/i, '').replace(/^\.\//, '');
      dirs.add(dir || '.');
    }
  }
  return [...dirs].slice(0, MAX_SKILLS);
}

export function parseEvals(raw: unknown): InspectedEvals | undefined {
  if (raw === null || raw === undefined) return undefined;
  const collectNames = (arr: unknown[]): string[] =>
    arr
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (isRecord(entry)) {
          return (
            (entry.name as string) ||
            (entry.id as string) ||
            (entry.title as string) ||
            ''
          );
        }
        return '';
      })
      .filter(Boolean)
      .slice(0, 20);

  if (Array.isArray(raw)) {
    return { count: raw.length, cases: collectNames(raw) };
  }
  if (isRecord(raw)) {
    for (const key of ['cases', 'tests', 'evals', 'assertions']) {
      const value = raw[key];
      if (Array.isArray(value)) {
        return { count: value.length, cases: collectNames(value) };
      }
    }
    const keys = Object.keys(raw);
    if (keys.length > 0)
      return { count: keys.length, cases: keys.slice(0, 20) };
  }
  return undefined;
}

export function workflowFromManifest(
  manifest: unknown,
): PluginInspection['workflow'] | undefined {
  if (!isRecord(manifest)) return undefined;
  const od = isRecord(manifest.od) ? manifest.od : null;
  if (!od) return undefined;
  const inputs = Array.isArray(od.inputs)
    ? od.inputs
        .map((i) =>
          isRecord(i) ? (i.label as string) || (i.name as string) : undefined,
        )
        .filter((v): v is string => Boolean(v))
    : undefined;
  const pipeline =
    isRecord(od.pipeline) && Array.isArray(od.pipeline.stages)
      ? od.pipeline.stages
          .map((s) => (isRecord(s) ? (s.id as string) : undefined))
          .filter((v): v is string => Boolean(v))
      : undefined;
  const capabilities = Array.isArray(od.capabilities)
    ? od.capabilities.filter((c): c is string => typeof c === 'string')
    : undefined;
  return {
    mode: typeof od.mode === 'string' ? od.mode : undefined,
    scenario: typeof od.scenario === 'string' ? od.scenario : undefined,
    kind: typeof od.kind === 'string' ? od.kind : undefined,
    inputs,
    pipeline,
    capabilities,
  };
}

/**
 * Inspect a catalog plugin's contents from its source. Returns skills, evals,
 * README, and Open Design workflow metadata when available.
 */
export async function inspectCatalogPlugin(
  source: CatalogSource,
  marketplaceUrl: string,
): Promise<PluginInspection> {
  let target;
  try {
    target = resolvePluginFetchTarget(source, marketplaceUrl);
  } catch {
    return { inspectable: false, skills: [] };
  }
  if (target.kind !== 'github') {
    return { inspectable: false, skills: [] };
  }

  const base = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${encodeURIComponent(
    target.ref,
  )}/${target.subdir ? `${target.subdir.replace(/\/+$/, '')}/` : ''}`;

  const [odManifest, claudeManifest, evalsJson, readme] = await Promise.all([
    fetchJson(`${base}open-design.json`),
    fetchJson(`${base}.claude-plugin/plugin.json`),
    fetchJson(`${base}evals/evals.json`),
    fetchRawText(`${base}README.md`),
  ]);
  const manifest = odManifest ?? claudeManifest;

  const skills: InspectedSkill[] = [];
  const dirs = skillDirsFromManifest(manifest);
  const skillFiles = await Promise.all(
    dirs.map((dir) =>
      fetchRawText(`${base}${dir === '.' ? '' : `${dir}/`}SKILL.md`).then(
        (text) => ({ dir, text }),
      ),
    ),
  );
  for (const { dir, text } of skillFiles) {
    if (!text) continue;
    const fm = parseMarkdownFrontmatter(text)?.attributes ?? {};
    const name = typeof fm.name === 'string' ? fm.name : dir;
    const description =
      typeof fm.description === 'string' ? fm.description : '';
    if (name) skills.push({ name, description, path: dir });
  }

  return {
    inspectable: true,
    skills,
    evals: parseEvals(evalsJson),
    readme: readme ? readme.slice(0, 4000) : undefined,
    workflow: workflowFromManifest(manifest),
  };
}
