import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { daemonListenerConfig } from '@/config/daemon-listener';

/**
 * Regression coverage for issue #200: the daemon listened on every interface
 * with no authentication unless WebUI auth happened to be enabled, so anything
 * on the same network could reach the sandbox and file routes. Local mode now
 * binds to loopback, and remote mode refuses to start without credentials.
 */
describe('daemon listener configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds to loopback for local operation', () => {
    vi.stubEnv('NEUMAR_REMOTE', '');
    vi.stubEnv('WEBUI_AUTH', '');
    vi.stubEnv('WEBUI_JWT_SECRET', '');

    expect(daemonListenerConfig()).toEqual({
      hostname: '127.0.0.1',
      remote: false,
    });
  });

  it('binds to every interface in remote mode with credentials configured', () => {
    vi.stubEnv('NEUMAR_REMOTE', 'true');
    vi.stubEnv('WEBUI_AUTH', 'true');
    vi.stubEnv('WEBUI_JWT_SECRET', 'a-signing-secret');

    expect(daemonListenerConfig()).toEqual({
      hostname: '0.0.0.0',
      remote: true,
    });
  });

  it('refuses remote mode without WebUI authentication', () => {
    vi.stubEnv('NEUMAR_REMOTE', 'true');
    vi.stubEnv('WEBUI_AUTH', '');
    vi.stubEnv('WEBUI_JWT_SECRET', 'a-signing-secret');

    expect(() => daemonListenerConfig()).toThrow(
      'NEUMAR_REMOTE=true requires WEBUI_AUTH=true',
    );
  });

  it('refuses WebUI authentication without a signing secret', () => {
    vi.stubEnv('NEUMAR_REMOTE', '');
    vi.stubEnv('WEBUI_AUTH', 'true');
    vi.stubEnv('WEBUI_JWT_SECRET', '   ');

    expect(() => daemonListenerConfig()).toThrow(
      'WEBUI_AUTH=true requires WEBUI_JWT_SECRET',
    );
  });

  it('passes the resolved hostname to the listener', () => {
    // The configuration is only worth anything if the server uses it. An
    // import without the `hostname` option leaves Bun listening on every
    // interface while the tests above still pass.
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/http-daemon.ts', import.meta.url)),
      'utf8',
    );
    const serveCall = source.slice(source.indexOf('server = serve({'));
    expect(serveCall.slice(0, serveCall.indexOf('})'))).toContain(
      'hostname: listener.hostname',
    );
  });
});
