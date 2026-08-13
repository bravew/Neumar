// Probe pipeline: resolve binary → version → capability flags → models →
// best-effort auth. Mirrors open-design's detect/probe shape but split for
// testability and TypeScript ergonomics.

import { execFile } from 'child_process';
import { promisify } from 'util';

import { createLogger } from '@/shared/utils/logger';

import { commandHash, platformOptions, renderShellPreview } from './install.js';
import { withModelSource } from './models.js';
import { fallbackModelsFor, AGENT_DEFS, stripFns } from './registry.js';
import {
  getConfiguredExecutablePath,
  resolveConfiguredBinary,
  resolveOnPath,
} from './resolve.js';
import type {
  AgentRuntimeDef,
  AgentRuntimeStatus,
  ModelOption,
  RuntimeCapabilities,
  RuntimeDiagnostic,
} from './types.js';
import { rememberLiveModels } from './validation.js';

const logger = createLogger('AgentRuntimes');
const execFileP = promisify(execFile);

// Per-agent capability flags. Populated from `--help` substring matches at
// probe time. buildArgs (Phase 5) consults this to gate optional flags so
// older CLI builds don't reject unknown flags.
const agentCapabilities = new Map<string, Record<string, boolean>>();

export function getCapabilities(
  agentId: string,
): Record<string, boolean> | undefined {
  return agentCapabilities.get(agentId);
}

const VERSION_TIMEOUT_MS = 3000;
const HELP_TIMEOUT_MS = 5000;
const HELP_MAX_BUFFER = 4 * 1024 * 1024;
const MODELS_MAX_BUFFER = 8 * 1024 * 1024;

async function fetchModels(
  def: AgentRuntimeDef,
  resolvedBin: string,
  diagnostics: RuntimeDiagnostic[],
): Promise<ModelOption[]> {
  if (typeof def.fetchModels === 'function') {
    try {
      const parsed = await def.fetchModels(resolvedBin);
      if (parsed && parsed.length > 0) {
        return withModelSource(parsed, 'discovered');
      }
      diagnostics.push({
        level: 'info',
        message: 'Custom model probe returned no entries; using fallback list.',
      });
      return fallbackModelsFor(def);
    } catch (err) {
      diagnostics.push({
        level: 'warn',
        message: `Model probe failed: ${(err as Error).message}`,
      });
      return fallbackModelsFor(def);
    }
  }
  if (!def.listModels) return fallbackModelsFor(def);
  try {
    const { stdout } = await execFileP(resolvedBin, def.listModels.args, {
      timeout: def.listModels.timeoutMs ?? 5000,
      maxBuffer: MODELS_MAX_BUFFER,
    });
    const parsed = def.listModels.parse(stdout);
    if (!parsed || parsed.length === 0) {
      diagnostics.push({
        level: 'info',
        message: 'CLI returned no models; using fallback list.',
      });
      return fallbackModelsFor(def);
    }
    return withModelSource(parsed, 'discovered');
  } catch (err) {
    diagnostics.push({
      level: 'warn',
      message: `\`${def.bin} ${def.listModels.args.join(' ')}\` failed: ${(err as Error).message}`,
    });
    return fallbackModelsFor(def);
  }
}

export function deriveRuntimeCapabilities(
  def: AgentRuntimeDef,
  flags: Record<string, boolean>,
): RuntimeCapabilities {
  const isAcp = def.streamFormat === 'acp-json-rpc';
  const isRpc = def.streamFormat === 'pi-rpc';
  const isStructured =
    def.streamFormat !== 'plain' && def.streamFormat !== 'pi-rpc';
  return {
    execution: typeof def.buildArgs === 'function',
    structuredStream: isStructured,
    acp: isAcp,
    rpc: isRpc,
    ...def.capabilities,
    flags: Object.keys(flags).length > 0 ? flags : undefined,
  };
}

function enrichInstallOptions(def: AgentRuntimeDef) {
  const stripped = stripFns(def);
  return {
    stripped,
    install: platformOptions(stripped.install ?? [], process.platform).map(
      (option) => ({
        ...option,
        commandHash: commandHash(option),
        rendered: renderShellPreview(option),
      }),
    ),
    update: platformOptions(stripped.update ?? [], process.platform).map(
      (option) => ({
        ...option,
        commandHash: commandHash(option),
        rendered: renderShellPreview(option),
      }),
    ),
  };
}

function unavailableStatus(
  def: AgentRuntimeDef,
  diagnostics: RuntimeDiagnostic[],
): AgentRuntimeStatus {
  const enriched = enrichInstallOptions(def);
  agentCapabilities.set(def.id, {});
  return {
    ...enriched.stripped,
    install: enriched.install,
    update: enriched.update,
    models: fallbackModelsFor(def),
    available: false,
    capabilities: deriveRuntimeCapabilities(def, {}),
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

function probeFailedStatus(
  def: AgentRuntimeDef,
  err: unknown,
): AgentRuntimeStatus {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn('probe_failed', { runtimeId: def.id, err: message });
  try {
    return unavailableStatus(def, [
      {
        level: 'warn',
        message: `Probe failed: ${message}`,
      },
    ]);
  } catch {
    const stripped = stripFns(def);
    return {
      ...stripped,
      models: fallbackModelsFor(def),
      available: false,
      capabilities: {
        execution: false,
        structuredStream: false,
        acp: false,
        rpc: false,
      },
      diagnostics: [
        {
          level: 'warn',
          message: `Probe failed: ${message}`,
        },
      ],
    };
  }
}

async function probeUnchecked(
  def: AgentRuntimeDef,
): Promise<AgentRuntimeStatus> {
  const diagnostics: RuntimeDiagnostic[] = [];
  const configuredPath = getConfiguredExecutablePath(def.id);
  const configuredResolved = resolveConfiguredBinary(def.id);
  const pathResolved = resolveOnPath(def.bin);
  let resolved = configuredResolved ?? pathResolved;
  if (configuredPath && !configuredResolved) {
    diagnostics.push({
      level: 'warn',
      message: pathResolved
        ? `Configured executable not found: ${configuredPath}. Using PATH executable: ${pathResolved.path}`
        : `Configured executable not found: ${configuredPath}`,
    });
  }
  const enriched = enrichInstallOptions(def);

  if (!resolved) {
    return unavailableStatus(def, diagnostics);
  }

  let version: string | undefined;
  try {
    const { stdout } = await execFileP(resolved.path, def.versionArgs, {
      timeout: VERSION_TIMEOUT_MS,
    });
    version = stdout.trim().split('\n')[0];
  } catch (err) {
    const detail = (err as Error).message;
    if (
      def.id === 'codex' &&
      resolved.source === 'configured' &&
      pathResolved &&
      pathResolved.path !== resolved.path
    ) {
      diagnostics.push({
        level: 'warn',
        message: `Configured Codex executable failed version probe at ${resolved.path}: ${detail}. Using PATH executable: ${pathResolved.path}`,
      });
      resolved = pathResolved;
      try {
        const { stdout } = await execFileP(resolved.path, def.versionArgs, {
          timeout: VERSION_TIMEOUT_MS,
        });
        version = stdout.trim().split('\n')[0];
      } catch (fallbackErr) {
        diagnostics.push({
          level: 'warn',
          message: `Fallback version probe failed: ${(fallbackErr as Error).message}`,
        });
      }
    } else {
      diagnostics.push({
        level: 'warn',
        message: `Version probe failed: ${detail}`,
      });
    }
  }

  // --help substring grep for capability flags. Failure here just leaves
  // capabilities empty — buildArgs will fall back to its safe baseline.
  const flags: Record<string, boolean> = {};
  if (def.helpArgs && def.capabilityFlags) {
    try {
      const { stdout } = await execFileP(resolved.path, def.helpArgs, {
        timeout: HELP_TIMEOUT_MS,
        maxBuffer: HELP_MAX_BUFFER,
      });
      for (const [flag, key] of Object.entries(def.capabilityFlags)) {
        flags[key] = stdout.includes(flag);
      }
    } catch {
      // Leave flags empty.
    }
  }
  agentCapabilities.set(def.id, flags);

  const models = await fetchModels(def, resolved.path, diagnostics);

  let auth: AgentRuntimeStatus['auth'];
  if (typeof def.authProbe === 'function') {
    try {
      auth = await def.authProbe(resolved.path);
    } catch {
      auth = { state: 'unknown' };
    }
  }

  return {
    ...enriched.stripped,
    install: enriched.install,
    update: enriched.update,
    available: true,
    path: resolved.path,
    source: resolved.source,
    version,
    models,
    auth,
    capabilities: deriveRuntimeCapabilities(def, flags),
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

async function probe(def: AgentRuntimeDef): Promise<AgentRuntimeStatus> {
  try {
    return await probeUnchecked(def);
  } catch (err) {
    return probeFailedStatus(def, err);
  }
}

interface DetectionCacheEntry {
  expiresAt: number;
  results: AgentRuntimeStatus[];
}

let cache: DetectionCacheEntry | null = null;
let inflight: Promise<AgentRuntimeStatus[]> | null = null;
const CACHE_TTL_MS = 30_000;

function nowMs(): number {
  return Date.now();
}

export async function detectAgents(
  options: {
    force?: boolean;
  } = {},
): Promise<AgentRuntimeStatus[]> {
  const force = options.force === true;
  if (!force && cache && cache.expiresAt > nowMs()) {
    return cache.results;
  }
  if (inflight) return inflight;
  const started = nowMs();
  inflight = (async () => {
    try {
      const settled = await Promise.allSettled(AGENT_DEFS.map(probe));
      const results = settled.map((result, index) => {
        const def = AGENT_DEFS[index]!;
        return result.status === 'fulfilled'
          ? result.value
          : probeFailedStatus(def, result.reason);
      });
      for (const agent of results) {
        rememberLiveModels(agent.id, agent.models);
      }
      cache = {
        results,
        expiresAt: nowMs() + CACHE_TTL_MS,
      };
      logger.info(
        `Detected ${results.filter((r) => r.available).length}/${results.length} runtimes in ${nowMs() - started}ms`,
      );
      return results;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function detectAgent(
  id: string,
): Promise<AgentRuntimeStatus | null> {
  const def = AGENT_DEFS.find((a) => a.id === id);
  if (!def) return null;
  const status = await probe(def);
  // Refresh just this entry in the cache so subsequent list calls reflect it.
  if (cache) {
    cache.results = cache.results.map((r) => (r.id === id ? status : r));
  }
  rememberLiveModels(status.id, status.models);
  return status;
}

export function invalidateDetectionCache(): void {
  cache = null;
}

export function getCachedAgentRuntimeStatus(
  id: string,
): AgentRuntimeStatus | undefined {
  if (!cache || cache.expiresAt <= nowMs()) return undefined;
  return cache.results.find((runtime) => runtime.id === id);
}
