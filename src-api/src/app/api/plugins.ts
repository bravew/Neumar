/**
 * Plugins API — list, install (local/github/url), enable/disable, uninstall,
 * scaffold, marketplace sources.
 */

import fs from 'fs/promises';
import { homedir } from 'os';
import { isAbsolute, join, resolve, sep } from 'path';

import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { getAppDir } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import {
  deleteInstalledPlugin,
  deletePluginConfigValue,
  deletePluginConfigValues,
  getInstalledPlugin,
  listPluginConfigValues,
  listInstalledPlugins,
  setPluginEnabled,
  upsertPluginConfigValue,
} from '@/shared/db/plugins';
import {
  buildPublicPluginConfig,
  createPlugin,
  fetchAllRegistries,
  loadPlugins,
  pluginConfigSecretName,
  PLUGIN_NAME_RE,
  PluginManifestSchema,
  validatePluginConfigPatch,
  type PluginManifest,
} from '@/shared/plugins';
import { applyDesignPlugin } from '@/shared/plugins/design';
import { inspectCatalogPlugin } from '@/shared/plugins/inspect';
import {
  installPluginFromDir,
  PluginInstallError,
  type InstallProvenance,
} from '@/shared/plugins/install';
import {
  fetchCatalogPlugin,
  fetchGithubPlugin,
  fetchUrlPlugin,
  type CatalogSource,
} from '@/shared/plugins/remote-install';
import {
  addMarketplaceSource,
  listAvailablePlugins,
  getMarketplaceSources,
  MarketplaceSourceError,
  refreshMarketplaceSource,
  removeMarketplaceSource,
  resolveCatalogEntry,
} from '@/shared/plugins/sources';
import { applyTaskPlugin } from '@/shared/plugins/task';
import {
  deleteSecret,
  listSecretsWithHints,
  storeSecret,
} from '@/shared/security/secrets';
import { createLogger } from '@/shared/utils/logger';
import {
  applyVideoPlugin,
  createVideoPluginRunSnapshot,
  loadVideoPlugins,
} from '@/shared/video/plugins';

const logger = createLogger('PluginsAPI');

const pluginsRoutes = new Hono();

const ScopeFilter = z.enum([
  'project',
  'user',
  'marketplace',
  'bundled',
  'legacy',
]);

const ListQuery = z.object({
  scope: ScopeFilter.optional(),
  enabledOnly: z
    .union([
      z.literal('1'),
      z.literal('true'),
      z.literal('0'),
      z.literal('false'),
    ])
    .optional(),
});

const InstallLocalBody = z.object({
  source: z.literal('local'),
  ref: z.string().min(1),
  scope: z.enum(['project', 'user']).default('user'),
});

const InstallNetworkBody = z.object({
  source: z.enum(['github', 'url']),
  ref: z.string().min(1),
  scope: z.enum(['project', 'user']).default('user'),
  /** Marketplace provenance: which source/entry drove this install. */
  marketplaceSourceId: z.string().min(1).max(64).optional(),
  entryName: z.string().min(1).max(128).optional(),
});

/**
 * Install a catalog entry by (source, entry). The backend resolves the
 * entry's advertised install source — relative path, github ref, https zip,
 * or object form — so the client never has to understand source formats.
 */
const InstallMarketplaceBody = z.object({
  source: z.literal('marketplace'),
  marketplaceSourceId: z.string().min(1).max(64),
  entryName: z.string().min(1).max(128),
  scope: z.enum(['project', 'user']).default('user'),
});

const InstallBody = z.union([
  InstallLocalBody,
  InstallMarketplaceBody,
  InstallNetworkBody,
]);

const AddSourceBody = z
  .object({
    url: z.string().url().max(500),
    trust: z.enum(['official', 'restricted']).default('restricted'),
    name: z.string().min(1).max(100).optional(),
  })
  .strict();

const ScaffoldBody = z.object({
  name: z
    .string()
    .regex(PLUGIN_NAME_RE, 'name must be lower-kebab-case (a-z, 0-9, -)'),
  template: z.enum(['basic', 'with-script', 'with-mcp']).optional(),
  description: z.string().min(1).max(500).optional(),
  vars: z.record(z.string(), z.string()).optional(),
});

const ConfigBody = z
  .object({
    values: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  })
  .strict();

const ApplyBody = z
  .object({
    surface: z.enum(['task', 'design', 'video', 'chat']).default('task'),
    inputs: z.record(z.string(), z.unknown()).optional(),
    approvedCapabilities: z.array(z.string().min(1)).max(50).optional(),
    lastReviewedDigest: z.string().min(1).nullable().optional(),
    signatureOk: z.boolean().nullable().optional(),
  })
  .strict();

/**
 * Allowlist of root dirs from which a `source: 'local'` install may copy.
 * Returns the resolved (symlink-followed) source path on success, or an error
 * string on rejection. Defeats `ref: '/etc/ssl/private'`-style attacks even
 * when the attacker plants a symlink inside their own dir.
 */
async function resolveAllowedSource(
  ref: string,
): Promise<
  { ok: true; path: string } | { ok: false; status: 400 | 404; error: string }
> {
  if (!isAbsolute(ref)) {
    return { ok: false, status: 400, error: 'ref must be an absolute path' };
  }
  let real: string;
  try {
    real = await fs.realpath(resolve(ref));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, status: 404, error: 'source path does not exist' };
    }
    throw err;
  }

  const home = homedir();
  const workDir = getSetting('workDir');
  const roots = [home, getAppDir(), workDir].filter(
    (r): r is string => typeof r === 'string' && r.length > 0,
  );
  const within = roots.some(
    (root) => real === root || real.startsWith(root + sep),
  );
  if (!within) {
    return {
      ok: false,
      status: 400,
      error: `ref must be within the user home, workspace, or app dir`,
    };
  }
  return { ok: true, path: real };
}

pluginsRoutes.get('/', zValidator('query', ListQuery), (c) => {
  const { scope, enabledOnly } = c.req.valid('query');
  const installed = listInstalledPlugins({
    scope,
    enabledOnly: enabledOnly === '1' || enabledOnly === 'true',
  });
  return c.json({ plugins: installed });
});

pluginsRoutes.get('/discovered', async (c) => {
  const plugins = await loadPlugins();
  return c.json({
    plugins: plugins.map((p) => ({
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      scope: p.scope,
      path: p.path,
      skillCount: p.skills.length,
      skills: p.skills.map((s) => ({
        name: s.name,
        bareName: s.bareName,
        path: s.path,
        modes: s.metadata.modes,
      })),
    })),
  });
});

// --- Marketplace sources -----------------------------------------------
// Registered before the `/:id{.+}` catch-alls so `marketplaces/...` paths are
// never swallowed by the plugin-id matcher.

pluginsRoutes.get('/marketplaces', (c) => {
  return c.json({ sources: getMarketplaceSources() });
});

pluginsRoutes.get('/marketplaces/available', async (c) => {
  const { entries, sources } = await listAvailablePlugins();
  return c.json({ entries, sources });
});

pluginsRoutes.post(
  '/marketplaces',
  zValidator('json', AddSourceBody),
  async (c) => {
    try {
      const source = await addMarketplaceSource(c.req.valid('json'));
      return c.json({ source }, 201);
    } catch (err) {
      return marketplaceSourceErrorResponse(c, err);
    }
  },
);

pluginsRoutes.post('/marketplaces/:sourceId/refresh', async (c) => {
  try {
    const source = await refreshMarketplaceSource(c.req.param('sourceId'));
    return c.json({ source });
  } catch (err) {
    return marketplaceSourceErrorResponse(c, err);
  }
});

/** Pre-install inspection: skills, evals, and workflow from the plugin source. */
pluginsRoutes.get('/marketplaces/:sourceId/inspect', async (c) => {
  const entryName = c.req.query('entry');
  if (!entryName) return c.json({ error: 'entry query param required' }, 400);
  try {
    const resolved = await resolveCatalogEntry(
      c.req.param('sourceId'),
      entryName,
    );
    const inspection = await inspectCatalogPlugin(
      resolved.entry.source as CatalogSource,
      resolved.source.url,
    );
    return c.json({ inspection });
  } catch (err) {
    return marketplaceSourceErrorResponse(c, err);
  }
});

pluginsRoutes.delete('/marketplaces/:sourceId', (c) => {
  if (!removeMarketplaceSource(c.req.param('sourceId'))) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.json({ ok: true });
});

function marketplaceSourceErrorResponse(c: Context, err: unknown) {
  if (err instanceof MarketplaceSourceError) {
    return c.json({ error: err.message }, err.status);
  }
  logger.error('Marketplace source request failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  return c.json({ error: 'internal server error' }, 500);
}

// -------------------------------------------------------------------------

pluginsRoutes.post(
  '/:id{.+}/apply',
  zValidator('json', ApplyBody),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');

    if (body.surface === 'chat') {
      return c.json(
        {
          error: 'not implemented',
          message: 'Chat plugin apply ships in a follow-up checkpoint.',
        },
        501,
      );
    }

    try {
      if (body.surface === 'video') {
        const applied = await applyVideoSurfacePlugin(id, body);
        return c.json({ applied });
      }

      const applied =
        body.surface === 'design'
          ? await applyDesignPlugin(id, {
              inputs: body.inputs,
              approvedCapabilities: body.approvedCapabilities,
              lastReviewedDigest: body.lastReviewedDigest,
              signatureOk: body.signatureOk,
            })
          : await applyTaskPlugin(id, { inputs: body.inputs });
      return c.json({
        applied: {
          pluginId: applied.pluginId,
          snapshot: applied.snapshot,
          context: {
            pinnedSkills: applied.pinnedSkills,
            publicConfig: applied.config.publicValues,
            sensitiveConfigKeys: applied.config.sensitiveKeys,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status: ContentfulStatusCode = message.includes('not found')
        ? 404
        : message.includes('disabled')
          ? 409
          : 400;
      return c.json({ error: 'apply failed', message }, status);
    }
  },
);

pluginsRoutes.get('/:id{.+}/config', async (c) => {
  const id = c.req.param('id');
  const plugin = getInstalledPlugin(id);
  if (!plugin) return c.json({ error: 'not found' }, 404);

  const manifest = parseInstalledPluginManifest(plugin.manifest);
  if (!manifest) return c.json({ error: 'invalid manifest' }, 400);

  return c.json({
    config: await buildConfigResponse(id, manifest),
  });
});

pluginsRoutes.put(
  '/:id{.+}/config',
  zValidator('json', ConfigBody),
  async (c) => {
    const id = c.req.param('id');
    const plugin = getInstalledPlugin(id);
    if (!plugin) return c.json({ error: 'not found' }, 404);

    const manifest = parseInstalledPluginManifest(plugin.manifest);
    if (!manifest) return c.json({ error: 'invalid manifest' }, 400);

    const validation = validatePluginConfigPatch(
      manifest,
      c.req.valid('json').values,
    );
    if (!validation.ok) {
      return c.json(
        { error: 'invalid config', issues: validation.issues },
        400,
      );
    }

    for (const entry of validation.entries) {
      if (entry.remove) {
        const deleted = deletePluginConfigValue(id, entry.key);
        if (deleted?.secretName) await deleteSecret(deleted.secretName);
        continue;
      }

      const sensitive =
        entry.field.type === 'secret' || entry.field.sensitive === true;
      if (entry.field.type === 'secret') {
        const secretName = pluginConfigSecretName(id, entry.key);
        await storeSecret(secretName, String(entry.value));
        upsertPluginConfigValue({
          pluginId: id,
          key: entry.key,
          secretName,
          sensitive: true,
        });
        continue;
      }

      upsertPluginConfigValue({
        pluginId: id,
        key: entry.key,
        value: entry.value,
        sensitive,
      });
    }

    logger.info(`Updated plugin config for ${id}`, {
      keyCount: validation.entries.length,
    });
    return c.json({ config: await buildConfigResponse(id, manifest) });
  },
);

/**
 * Design-system preview: serve the plugin's bundled `components.html` as raw
 * HTML for a sandboxed-iframe preview in the detail dialog (Open Design
 * parity). Only plugins that ship a `components.html` under their install dir
 * (design systems) have one; everything else 404s. The filename is a fixed
 * literal joined to the DB-trusted install path, so there is no traversal.
 */
pluginsRoutes.get('/:id{.+}/preview', async (c) => {
  const id = c.req.param('id');
  const plugin = getInstalledPlugin(id);
  if (!plugin) return c.json({ error: 'not found' }, 404);

  const base = resolve(plugin.installPath);
  const file = join(base, 'components.html');
  if (file !== resolve(file) || !file.startsWith(base + sep)) {
    return c.json({ error: 'not found' }, 404);
  }
  try {
    const html = await fs.readFile(file, 'utf8');
    return c.body(html, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
  } catch {
    return c.json({ error: 'no preview available' }, 404);
  }
});

pluginsRoutes.get('/:id{.+}', (c) => {
  const id = c.req.param('id');
  const plugin = getInstalledPlugin(id);
  if (!plugin) return c.json({ error: 'not found' }, 404);
  return c.json({ plugin });
});

pluginsRoutes.post('/install', zValidator('json', InstallBody), async (c) => {
  const data = c.req.valid('json');

  try {
    let stored;
    if (data.source === 'local') {
      const allowed = await resolveAllowedSource(data.ref);
      if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
      stored = await installPluginFromDir(allowed.path, {
        scope: data.scope,
        source: 'local',
        sourceRef: allowed.path,
      });
    } else if (data.source === 'marketplace') {
      // The backend owns source-format resolution: read the catalog entry's
      // advertised source (relative / github / url / object form), fetch it,
      // and stamp provenance from the SOURCE row (user-assigned trust).
      const resolved = await resolveCatalogEntry(
        data.marketplaceSourceId,
        data.entryName,
      );
      const fetched = await fetchCatalogPlugin(
        resolved.entry.source as CatalogSource,
        resolved.source.url,
      );
      try {
        stored = await installPluginFromDir(fetched.dir, {
          scope: data.scope,
          source: fetched.installKind,
          sourceRef: fetched.ref,
          provenance: {
            sourceMarketplaceId: resolved.source.id,
            sourceEntryName: resolved.entry.name,
            sourceEntryVersion: resolved.entry.version ?? null,
            marketplaceTrust: resolved.source.trust,
          },
        });
      } finally {
        await fetched.cleanup();
      }
    } else {
      // Direct github/url install (power users); provenance only when the
      // caller ties it to a marketplace source.
      let provenance: InstallProvenance | undefined;
      if (data.marketplaceSourceId) {
        const resolved = await resolveCatalogEntry(
          data.marketplaceSourceId,
          data.entryName ?? data.ref,
        );
        provenance = {
          sourceMarketplaceId: resolved.source.id,
          sourceEntryName: resolved.entry.name,
          sourceEntryVersion: resolved.entry.version ?? null,
          marketplaceTrust: resolved.source.trust,
        };
      }
      const fetched =
        data.source === 'github'
          ? await fetchGithubPlugin(data.ref)
          : await fetchUrlPlugin(data.ref);
      try {
        stored = await installPluginFromDir(fetched.dir, {
          scope: data.scope,
          source: data.source,
          sourceRef: data.ref,
          provenance,
        });
      } finally {
        await fetched.cleanup();
      }
    }

    logger.info(
      `Installed plugin ${stored.name}@${stored.version} → ${stored.installPath}`,
    );
    return c.json({ plugin: stored }, 201);
  } catch (err) {
    if (err instanceof PluginInstallError) {
      return c.json({ error: err.message, issues: err.issues }, err.status);
    }
    if (err instanceof MarketplaceSourceError) {
      return c.json({ error: err.message }, err.status);
    }
    throw err;
  }
});

pluginsRoutes.post('/:id{.+}/enable', (c) => {
  const id = c.req.param('id');
  if (!setPluginEnabled(id, true)) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.json({ plugin: getInstalledPlugin(id) });
});

pluginsRoutes.post('/:id{.+}/disable', (c) => {
  const id = c.req.param('id');
  if (!setPluginEnabled(id, false)) {
    return c.json({ error: 'not found' }, 404);
  }
  return c.json({ plugin: getInstalledPlugin(id) });
});

pluginsRoutes.delete('/:id{.+}', async (c) => {
  const id = c.req.param('id');
  const plugin = getInstalledPlugin(id);
  if (!plugin) return c.json({ error: 'not found' }, 404);

  // Built-ins ship with the app and can't be uninstalled — only disabled.
  // Deleting the row would just be re-seeded on the next reconcile.
  if (plugin.scope === 'bundled') {
    return c.json(
      {
        error: 'built-in plugins cannot be uninstalled; disable it instead',
      },
      400,
    );
  }

  try {
    await fs.rm(plugin.installPath, { recursive: true, force: true });
  } catch (err) {
    logger.warn(
      `Failed to remove install dir ${plugin.installPath}: ${(err as Error).message}`,
    );
  }

  for (const value of deletePluginConfigValues(id)) {
    if (value.secretName) await deleteSecret(value.secretName);
  }
  deleteInstalledPlugin(id);
  return c.json({ ok: true });
});

pluginsRoutes.post('/scaffold', zValidator('json', ScaffoldBody), async (c) => {
  const { name, template, description, vars } = c.req.valid('json');
  const dir = join(getAppDir(), 'plugins');
  try {
    await fs.mkdir(dir, { recursive: true });
    const result = await createPlugin({
      name,
      dir,
      template,
      description,
      vars,
    });
    logger.info(`Scaffolded plugin ${name} → ${result.pluginDir}`);
    return c.json(
      {
        pluginDir: result.pluginDir,
        manifestPath: result.manifestPath,
        files: result.files,
      },
      201,
    );
  } catch (err) {
    const message = (err as Error).message;
    const status = message.startsWith('Refusing to overwrite') ? 409 : 400;
    return c.json({ error: 'scaffold failed', message }, status);
  }
});

pluginsRoutes.get('/marketplace/index', async (c) => {
  const results = await fetchAllRegistries();
  const registries = results.map((r) => ({
    url: r.url,
    fromCache: r.fromCache,
    fetchedAt: r.fetchedAt,
    error: r.error,
    name: r.index?.name,
    description: r.index?.metadata?.description,
    owner: r.index?.owner,
    plugins: r.index?.plugins ?? [],
  }));
  const anyError = registries.some((r) => r.error);
  const status: ContentfulStatusCode = anyError ? 207 : 200;
  return c.json({ registries }, status);
});

function parseInstalledPluginManifest(value: unknown): PluginManifest | null {
  const parsed = PluginManifestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function buildConfigResponse(id: string, manifest: PluginManifest) {
  const secretHints = new Map(
    (await listSecretsWithHints()).map((secret) => [secret.name, secret.hint]),
  );
  return {
    pluginId: id,
    values: buildPublicPluginConfig(
      manifest,
      listPluginConfigValues(id),
      secretHints,
    ),
  };
}

async function applyVideoSurfacePlugin(
  id: string,
  body: z.infer<typeof ApplyBody>,
) {
  const installed = getInstalledPlugin(id);
  if (!installed) throw new Error(`Plugin not found: ${id}`);
  if (!installed.enabled) throw new Error(`Plugin is disabled: ${id}`);

  const manifest = parseInstalledPluginManifest(installed.manifest);
  if (!manifest) throw new Error('Installed plugin manifest is invalid');

  const { plugins, issues } = await loadVideoPlugins({
    watch: false,
    substratePlugins: [
      {
        manifest,
        scope: installed.scope,
        path: installed.installPath,
        skills: [],
      },
    ],
  });
  const plugin = plugins.find(
    (candidate) => candidate.id === id || candidate.id === installed.name,
  );
  if (!plugin) throw new Error(`Plugin not found: ${id}`);

  const applied = applyVideoPlugin(plugin, {
    inputs: body.inputs,
    approvedCapabilities: body.approvedCapabilities,
    lastReviewedDigest: body.lastReviewedDigest,
    signatureOk: body.signatureOk,
  });
  const snapshot = createVideoPluginRunSnapshot(applied.gate, {
    inputs: applied.context.pluginInputs,
  });
  return {
    pluginId: plugin.id,
    snapshot,
    prompt: applied.prompt,
    context: {
      plugin: applied.summary,
      gate: {
        restricted: applied.gate.restricted,
        grants: applied.gate.grants,
        requestedCapabilities: applied.gate.requestedCapabilities,
        grantedCapabilities: applied.gate.grantedCapabilities,
        deniedCapabilities: applied.gate.deniedCapabilities,
        requiresReview: applied.summary.requiresReview,
        promptGuideIncluded: Boolean(applied.gate.promptContext),
      },
      videoContext: applied.context,
      issues,
      publicConfig: applied.gate.config?.publicValues ?? {},
      sensitiveConfigKeys: applied.gate.config?.sensitiveKeys ?? [],
    },
  };
}

export { pluginsRoutes };
