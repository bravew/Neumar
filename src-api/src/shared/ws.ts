/**
 * Shared WebSocket Setup
 *
 * Provides the `upgradeWebSocket` and `injectWebSocket` helpers from
 * `@hono/node-ws`, bound to the application's Hono instance.
 *
 * Both `index.ts` (server bootstrap) and route handlers (e.g., speech.ts)
 * import from here to avoid circular dependencies.
 *
 * Usage:
 *   1. index.ts calls `initWebSocket(app)` at startup before mounting routes
 *   2. Route handlers call `getUpgradeWebSocket()` to get the bound middleware
 *   3. index.ts calls `getInjectWebSocket()(server)` after `serve()`
 *
 * @module shared/ws
 */

import { createNodeWebSocket } from '@hono/node-ws';
import type { Hono } from 'hono';

type NodeWS = ReturnType<typeof createNodeWebSocket>;

let _upgradeWebSocket: NodeWS['upgradeWebSocket'] | null = null;
let _injectWebSocket: NodeWS['injectWebSocket'] | null = null;

/**
 * Initialise WebSocket support for the given Hono app.
 * Must be called exactly once during server bootstrap (in `index.ts`),
 * before mounting any routes that use WebSocket.
 */
export function initWebSocket(app: Hono): void {
  const ws = createNodeWebSocket({ app });
  _upgradeWebSocket = ws.upgradeWebSocket;
  _injectWebSocket = ws.injectWebSocket;
}

/**
 * Get the `upgradeWebSocket` middleware factory.
 * Throws if called before `initWebSocket()`.
 */
export function getUpgradeWebSocket(): NodeWS['upgradeWebSocket'] {
  if (!_upgradeWebSocket) {
    throw new Error(
      'WebSocket not initialised. Call initWebSocket(app) first.',
    );
  }
  return _upgradeWebSocket;
}

/**
 * Get the `injectWebSocket` function for binding to the HTTP server.
 * Throws if called before `initWebSocket()`.
 */
export function getInjectWebSocket(): NodeWS['injectWebSocket'] {
  if (!_injectWebSocket) {
    throw new Error(
      'WebSocket not initialised. Call initWebSocket(app) first.',
    );
  }
  return _injectWebSocket;
}
