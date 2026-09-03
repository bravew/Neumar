import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';

import {
  agentRoutes,
  agentRuntimesRoutes,
  aguiRoutes,
  approvalRoutes,
  assetsRoutes,
  authRoutes,
  branchesRoutes,
  budgetRoutes,
  channelRoutes,
  cloudStorageRoutes,
  dbRoutes,
  doctorRoutes,
  documentsRoutes,
  feedbackRoutes,
  filesRoutes,
  gatewayRoutes,
  graphifyRoutes,
  healthRoutes,
  linearRoutes,
  linkPreviewRoutes,
  mcpRoutes,
  mcpRuntimeRoutes,
  mcpServerRoutes,
  memoryRoutes,
  observabilityRoutes,
  petsRoutes,
  pluginsRoutes,
  previewRoutes,
  profilesRoutes,
  publishRoutes,
  connectorsRoutes,
  providersRoutes,
  ragRoutes,
  designRoutes,
  runsRoutes,
  sandboxRoutes,
  searchRoutes,
  secretsRoutes,
  slackRoutes,
  speechRoutes,
  toolsRoutes,
  usageRoutes,
  videoRoutes,
} from '@/app/api';
import { acpRoutes, wellKnownRoutes } from '@/app/api/acp';
import { authJwtRoutes } from '@/app/api/auth-jwt';
import { automationRoutes } from '@/app/api/automation';
import { copilotKitRoutes } from '@/app/api/copilotkit';
import { mcpBridgeRoutes } from '@/app/api/mcp-bridge';
import { remoteRoutes } from '@/app/api/remote';
import { soulRoutes } from '@/app/api/soul';
import { corsMiddleware, jwtMiddleware } from '@/app/middleware/index.js';

import { getApprovalManager } from '@/core/approval-manager';
import * as queueManager from '@/core/queue-manager';

import { APP_DISPLAY_NAME } from '@/config/branding';
import { loadConfig } from '@/config/loader.js';

import {
  runAssetGarbageCollection,
  startAssetGcScheduler,
  startAssetJobWorkers,
  stopAssetGcScheduler,
  stopAssetJobWorkers,
} from '@/shared/assets';
import { initConnectionBroker } from '@/shared/auth/connection-broker';
import {
  startHealthMonitor,
  stopHealthMonitor,
} from '@/shared/auth/connection-health-monitor';
import { initCredentialVault } from '@/shared/auth/credential-vault';
import {
  startTokenRefreshService,
  stopTokenRefreshService,
} from '@/shared/auth/token-refresh-service';
import * as automationEngine from '@/shared/automation/engine';
import { getChannelManager } from '@/shared/channels/channel-manager';
// Plugin classes are now dynamically loaded by ChannelManager.loadAndStartAll()
import { closeDatabase, getDatabase } from '@/shared/db';
import { configureGlobalFetchProxyFromEnv } from '@/shared/http/proxy-dispatcher';
import {
  drainRequests,
  requestTrackerMiddleware,
  stopAcceptingRequests,
} from '@/shared/http/request-tracker';
import { bootstrapCloudStorageConnectionsCache } from '@/shared/integrations/cloud-storage';
import {
  startPathMappingReverificationScheduler,
  stopPathMappingReverificationScheduler,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';
import { ensureBridgeSecret } from '@/shared/mcp/public-server/secret';
import { getMemoryMonitor } from '@/shared/monitoring/memory-monitor';
import {
  ensureDefaultMarketplaceSource,
  reconcileBuiltinPlugins,
} from '@/shared/plugins';
import {
  initProviderManager,
  shutdownProviderManager,
} from '@/shared/provider/manager';
import { initSecretVault } from '@/shared/security/secrets';
import { reconcileAllDesignLiveArtifactManifests } from '@/shared/services/design-mode/live-artifacts';
import { reconcileRunningDesignMediaTasks } from '@/shared/services/design-mode/media-dispatcher';
import {
  startDesignRoutineScheduler,
  stopDesignRoutineScheduler,
} from '@/shared/services/design-mode/routines';
import { writeDaemonRecord } from '@/shared/services/external-mcp/daemon-record';
import { startPolling, stopPolling } from '@/shared/services/linear';
import { loadLinearConfig } from '@/shared/services/linear-config';
import { initializeMemory, shutdownMemory } from '@/shared/services/memory';
import {
  loadPersistedState,
  shutdownPipelines,
} from '@/shared/services/pipeline';
import { getPreviewManager } from '@/shared/services/preview';
import { getPublishOrchestrator } from '@/shared/services/publish';
import { createLogger } from '@/shared/utils/logger';
import { startVideoJobWorkers, stopVideoJobWorkers } from '@/shared/video/jobs';
import { getInjectWebSocket, initWebSocket } from '@/shared/ws';

const appLogger = createLogger('App');
configureGlobalFetchProxyFromEnv();

// ── Dev lifecycle tuning ──────────────────────────────────────────────
// `node --watch` (pnpm dev:api) restarts the whole process on every save.
// Two things made that feel "stuck": the 5s request-drain ran on every
// restart, and channel runtimes (Slack/Lark WebSockets, MCP stdio children)
// hold open handles that keep the old process alive past SIGTERM, so the
// port stays bound and the respawn hits EADDRINUSE.
const isProduction = process.env.NODE_ENV === 'production';
// Drain quickly in dev — there are no real in-flight clients to protect.
const DRAIN_TIMEOUT_MS = isProduction ? 5000 : 250;
// Skip the channel runtime in dev by default (the main source of un-reaped
// handles that wedge `node --watch` restarts). Opt back in with
// NEUMA_DEV_CHANNELS=1; hard kill switch for any mode with
// NEUMA_DISABLE_CHANNELS=1.
const channelsDisabled =
  process.env.NEUMA_DISABLE_CHANNELS === '1' ||
  (!isProduction && process.env.NEUMA_DEV_CHANNELS !== '1');

// Prevent unhandled rejections from crashing the process — channel plugins
// (Slack Bolt, Lark WS, etc.) can fire async errors outside of try/catch.
process.on('unhandledRejection', (reason) => {
  appLogger.error(
    'Unhandled rejection (non-fatal):',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
});

const app = new Hono();

// WebSocket support — required for streaming STT and conversation mode.
// Must be initialised before mounting routes that use upgradeWebSocket.
initWebSocket(app);

// Mount speech routes BEFORE global CORS middleware (WebSocket compatibility with @hono/node-ws).
// Apply CORS directly to speech routes so non-WebSocket endpoints (status, download) work from the browser.
app.use('/speech/*', corsMiddleware);
app.route('/speech', speechRoutes);

// ACP/A2A routes — same WebSocket+CORS gotcha as /speech (honojs/hono#4090).
// Mounted before global CORS+JWT; auth is enforced inside acp.ts via Bearer JWT.
app.use('/acp/*', corsMiddleware);
app.route('/acp', acpRoutes);
app.route('/.well-known', wellKnownRoutes);

// Web Remote (read-only). Served only when NEUMA_REMOTE_UI is set; bound to
// loopback in dev. Phase 6.1 will lift the read-only constraint and add the
// dual-listener tunnel.
const remoteUiMode = process.env.NEUMA_REMOTE_UI;
if (remoteUiMode === 'read-only' || remoteUiMode === 'interactive') {
  app.route('/remote', remoteRoutes);
  if (remoteUiMode === 'read-only') {
    appLogger.info('Web Remote: read-only mode enabled');
  } else {
    appLogger.warn(
      'Web Remote: interactive mode requested — not implemented in 6.0',
    );
  }
}

// Global middleware
app.use('*', corsMiddleware);
app.use('*', requestTrackerMiddleware);
app.use('*', jwtMiddleware);

// Body size limits: 100MB for agent routes (base64-encoded image attachments
// inflate ~33%, so 6 × 2.4MB raw ≈ 19MB wire), 10MB for everything else.
const AGENT_BODY_LIMIT = 100 * 1024 * 1024;
const VIDEO_BODY_LIMIT = 500 * 1024 * 1024;
const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024;
app.use('*', (c, next) => {
  const limit = c.req.path.startsWith('/agent')
    ? AGENT_BODY_LIMIT
    : c.req.path.startsWith('/video')
      ? VIDEO_BODY_LIMIT
      : DEFAULT_BODY_LIMIT;
  return bodyLimit({ maxSize: limit })(c, next);
});

// Routes
app.route('/health', healthRoutes);
app.route('/auth', authRoutes);
app.route('/agent', agentRoutes);
app.route('/agent-runtimes', agentRuntimesRoutes);
app.route('/assets', assetsRoutes);
app.route('/sandbox', sandboxRoutes);
app.route('/preview', previewRoutes);
app.route('/providers', providersRoutes);
app.route('/publish', publishRoutes);
app.route('/connectors', connectorsRoutes);
app.route('/files', filesRoutes);
app.route('/mcp', mcpRoutes);
app.route('/mcp/runtime', mcpRuntimeRoutes);
app.route('/mcp/bridge', mcpBridgeRoutes);
app.route('/mcp/server', mcpServerRoutes);
app.route('/plugins', pluginsRoutes);
app.route('/pets', petsRoutes);
app.route('/observability', observabilityRoutes);
app.route('/linear', linearRoutes);
app.route('/link-preview', linkPreviewRoutes);
app.route('/slack', slackRoutes);
app.route('/db', dbRoutes);
app.route('/design', designRoutes);
app.route('/automation', automationRoutes);
app.route('/memory', memoryRoutes);
app.route('/rag', ragRoutes);
app.route('/graphify', graphifyRoutes);
app.route('/usage', usageRoutes);
app.route('/video', videoRoutes);
app.route('/feedback', feedbackRoutes);
app.route('/budget', budgetRoutes);
app.route('/tasks', documentsRoutes);
app.route('/approvals', approvalRoutes);
app.route('/runs', runsRoutes);
app.route('/tools', toolsRoutes);
app.route('/auth/jwt', authJwtRoutes);
app.route('/channels', channelRoutes);
app.route('/cloud-storage', cloudStorageRoutes);
app.route('/gateway', gatewayRoutes);
app.route('/profiles', profilesRoutes);
app.route('/soul', soulRoutes);
app.route('/search', searchRoutes);
app.route('/secrets', secretsRoutes);
app.route('/tasks', branchesRoutes);
app.route('/ag-ui', aguiRoutes);
app.route('/doctor', doctorRoutes);
app.route('/', copilotKitRoutes);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: `${APP_DISPLAY_NAME} API`,
    version: '0.1.1',
    endpoints: {
      health: '/health',
      auth: '/auth',
      agent: '/agent',
      assets: '/assets',
      sandbox: '/sandbox',
      preview: '/preview',
      providers: '/providers',
      publish: '/publish',
      files: '/files',
      mcp: '/mcp',
      observability: '/observability',
      linear: '/linear',
      slack: '/slack',
      db: '/db',
      design: '/design',
      automation: '/automation',
      memory: '/memory',
      speech: '/speech',
      usage: '/usage',
      video: '/video',
      feedback: '/feedback',
      budget: '/budget',
      tasks: '/tasks',
      approvals: '/approvals',
      channels: '/channels',
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }

  appLogger.error('Unhandled server error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Default port: 5126 for development, 2620 for production (set via Tauri sidecar env)
const port = Number(process.env.PORT) || 5126;

// Store server instance for hot reload cleanup
let server: ServerType | null = null;

// Cleanup function (idempotent — concurrent SIGTERM/SIGINT signals share one
// shutdown promise so resources are not closed twice).
let cleanupPromise: Promise<void> | null = null;
const cleanup = (): Promise<void> => {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = runCleanup();
  return cleanupPromise;
};

const runCleanup = async () => {
  // Stop accepting new requests, drain in-flight ones up to 5s before closing
  // long-lived singletons (DB, channel manager, etc.).
  try {
    stopAcceptingRequests();
    await drainRequests(DRAIN_TIMEOUT_MS);
  } catch (error) {
    appLogger.error('Error draining in-flight requests:', error);
  }

  // Stop OAuth background services
  try {
    stopTokenRefreshService();
    stopHealthMonitor();
    stopPathMappingReverificationScheduler();
    stopAssetGcScheduler();
  } catch (error) {
    appLogger.error('Error stopping OAuth background services:', error);
  }

  // Stop queue manager
  try {
    queueManager.shutdown();
    stopAssetJobWorkers();
    stopVideoJobWorkers();
  } catch (error) {
    appLogger.error('Error shutting down queue manager:', error);
  }

  // Stop automation engine
  try {
    stopDesignRoutineScheduler();
    await automationEngine.shutdown();
  } catch (error) {
    appLogger.error('Error shutting down automation engine:', error);
  }

  // Stop Linear pipeline and poller
  try {
    stopPolling();
    await shutdownPipelines();
  } catch (error) {
    appLogger.error('Error shutting down Linear pipeline:', error);
  }

  // Stop publish worker
  try {
    await getPublishOrchestrator().stop();
  } catch (error) {
    appLogger.error('Error stopping publish orchestrator:', error);
  }

  // Stop all preview servers
  try {
    const previewManager = getPreviewManager();
    await previewManager.stopAll();
  } catch (error) {
    appLogger.error('Error stopping preview servers:', error);
  }

  // Stop memory monitor
  try {
    getMemoryMonitor().stop();
  } catch (error) {
    appLogger.error('Error stopping memory monitor:', error);
  }

  // Shutdown provider manager
  try {
    await shutdownProviderManager();
  } catch (error) {
    appLogger.error('Error shutting down provider manager:', error);
  }

  // Shutdown memory system
  try {
    shutdownMemory();
  } catch (error) {
    appLogger.error('Error shutting down memory system:', error);
  }

  // Shutdown approval manager
  try {
    getApprovalManager().shutdown();
  } catch (error) {
    appLogger.error('Error shutting down approval manager:', error);
  }

  // Stop channel plugins
  try {
    await getChannelManager().stopAll();
  } catch (error) {
    appLogger.error('Error stopping channel plugins:', error);
  }

  // Close database
  try {
    closeDatabase();
  } catch (error) {
    appLogger.error('Error closing database:', error);
  }

  if (server) {
    server.close();
    server = null;
  }
};

// Handle shutdown / hot-reload restart. A watchdog forces exit if a handle
// (channel WebSocket, MCP stdio child, lingering timer) refuses to drain —
// without it the old process keeps port 5126 bound and the `node --watch`
// respawn fails with EADDRINUSE. `process.on('exit')` cannot await async work,
// so cleanup must finish before we exit here.
const FORCE_EXIT_MS = isProduction ? 10_000 : 2_000;
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  appLogger.info(`Received ${signal}, shutting down...`);
  const watchdog = setTimeout(() => {
    appLogger.warn(`Cleanup exceeded ${FORCE_EXIT_MS}ms; forcing exit`);
    process.exit(0);
  }, FORCE_EXIT_MS);
  watchdog.unref();
  try {
    await cleanup();
  } catch (error) {
    appLogger.error('Error during shutdown cleanup:', error);
  } finally {
    clearTimeout(watchdog);
    process.exit(0);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Single-instance guard for daemon mode. When the launchd/systemd/Task
// Scheduler supervisor starts the sidecar, NEUMA_LAUNCHD_LABEL is set; if the
// HTTP port is already bound, another instance owns the daemon slot and we
// exit cleanly instead of racing.
async function singleInstanceGuard(targetPort: number): Promise<void> {
  if (!process.env.NEUMA_LAUNCHD_LABEL) return;
  const probe = await fetch(`http://127.0.0.1:${targetPort}/health`).catch(
    () => null,
  );
  if (probe?.ok) {
    appLogger.info(
      `Another sidecar already owns port ${targetPort} for label ${process.env.NEUMA_LAUNCHD_LABEL}; exiting.`,
    );
    process.exit(0);
  }
}

// Initialize and start server
export async function start() {
  appLogger.info(`${APP_DISPLAY_NAME} API starting...`);
  await singleInstanceGuard(port);

  // ── Phase 1: Start HTTP server immediately ──────────────────────────
  // The frontend (SetupGuard) polls /health/dependencies on launch.
  // If the server isn't listening yet, the user sees "Unable to check
  // dependencies". Start accepting connections first, then initialize
  // heavy subsystems.
  appLogger.info(`Server starting on http://localhost:${port}`);

  server = serve({
    fetch: app.fetch,
    port,
  });

  ensureBridgeSecret();
  writeDaemonRecord(`http://127.0.0.1:${port}`);

  // Inject WebSocket support into the HTTP server
  getInjectWebSocket()(server);

  // ── Phase 2: Core initialization ────────────────────────────────────
  // Load configuration
  await loadConfig();

  // Initialize database
  getDatabase();
  try {
    await runAssetGarbageCollection();
  } catch (error) {
    appLogger.warn('Asset startup cleanup failed (non-fatal):', error);
  }
  const recoveredDesignTasks = reconcileRunningDesignMediaTasks();
  if (recoveredDesignTasks > 0) {
    appLogger.warn(
      `Recovered ${recoveredDesignTasks} interrupted DesignMode media task(s)`,
    );
  }
  const reconciledLiveArtifacts =
    await reconcileAllDesignLiveArtifactManifests();
  if (reconciledLiveArtifacts.artifacts > 0) {
    appLogger.info(
      `Reconciled ${reconciledLiveArtifacts.artifacts} DesignMode live artifact manifest(s) across ${reconciledLiveArtifacts.projects} project(s)`,
    );
  }

  await bootstrapCloudStorageConnectionsCache();

  // Load encrypted channel credentials into memory before any channel code runs.
  // Also migrates any legacy plaintext tokens in SQLite to the vault.
  await initCredentialVault();

  // Load encrypted user secrets (API keys, tokens) from disk into memory.
  await initSecretVault();

  // Initialize provider manager
  await initProviderManager();

  // Load Linear config and restore pipeline state
  const linearConfig = await loadLinearConfig();
  await loadPersistedState();

  // Auto-start poller if previously enabled
  if (linearConfig.pollEnabled && linearConfig.apiKey) {
    startPolling(linearConfig);
  }

  // ── Phase 3: Optional / background services ─────────────────────────
  // Initialize OAuth connection broker (populates registry from persisted tokens)
  // then start background services that depend on it
  try {
    await initConnectionBroker();
    startTokenRefreshService();
    startHealthMonitor();
    startPathMappingReverificationScheduler();
    appLogger.info('OAuth connection broker and background services started');
  } catch (error) {
    appLogger.warn(
      'Failed to start OAuth background services (non-fatal):',
      error,
    );
  }

  // Initialize queue manager (crash recovery + in-memory state rebuild)
  queueManager.initialize();
  startAssetJobWorkers();
  startAssetGcScheduler();
  startVideoJobWorkers();

  // Start automation engine
  await automationEngine.start();
  startDesignRoutineScheduler();
  // Initialize memory system (loads sqlite-vec, creates virtual tables)
  await initializeMemory();

  // Check for embedding dimension changes and trigger reindex if needed (Phase 7B)
  try {
    const { checkDimensionChange } =
      await import('@/shared/services/memory/store');
    const { getMemoryConfig } = await import('@/shared/services/memory/config');
    await checkDimensionChange(getMemoryConfig());
  } catch (err) {
    appLogger.warn(`Dimension change check failed: ${err}`);
  }

  // Start memory monitoring at boot
  getMemoryMonitor().start();

  // Initialize channel plugins — dynamically loaded from DB configs.
  // Skipped in dev (see channelsDisabled) so their long-lived WebSocket/stdio
  // handles don't wedge the port on `node --watch` restarts.
  if (channelsDisabled) {
    appLogger.info(
      `Channel plugins disabled (${
        process.env.NEUMA_DISABLE_CHANNELS === '1'
          ? 'NEUMA_DISABLE_CHANNELS=1'
          : 'dev mode; set NEUMA_DEV_CHANNELS=1 to enable'
      })`,
    );
  } else {
    try {
      const channelMgr = getChannelManager();
      await channelMgr.loadAndStartAll();
      appLogger.info('Channel plugins initialized');
    } catch (err) {
      appLogger.warn('Channel plugin startup failed (non-fatal):', err);
    }
  }

  // Initialize approval manager (starts expiry sweep)
  getApprovalManager();

  // Seed the official website marketplace source when configured
  // (NEUMA_OFFICIAL_MARKETPLACE_URL). Idempotent.
  try {
    ensureDefaultMarketplaceSource();
  } catch (err) {
    appLogger.warn('Default marketplace source seed failed (non-fatal):', err);
  }

  // Register repo-shipped builtin plugins so they appear as "Built-in" and can
  // be toggled. Idempotent; preserves a user's disable.
  try {
    await reconcileBuiltinPlugins();
  } catch (err) {
    appLogger.warn('Builtin plugin reconcile failed (non-fatal):', err);
  }

  // Start publish worker after registry/database initialization.
  getPublishOrchestrator().start();

  appLogger.info(`${APP_DISPLAY_NAME} API fully initialized`);
}

// HTTP daemon only. MCP argv dispatch lives in src/index.ts so `mcp server`
// does not load SQLite, sharp, or the rest of the sidecar graph.
