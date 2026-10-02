/**
 * The one place the API decides where its data lives. Dependency-free (no
 * logger, no DB) so module-level paths, such as the log directory, can use it
 * without import cycles.
 *
 * `NEUMAR_APP_DATA_DIR` moves everything: the database, logs, sessions,
 * design and video projects, caches. Tests and isolated runs rely on that.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { APP_DATA_DIR } from './branding';

export function resolveAppDir(): string {
  const override = process.env.NEUMAR_APP_DATA_DIR?.trim();
  return override || join(homedir(), APP_DATA_DIR);
}

/**
 * Expands a stored path. `~/.<slug>` names the app data directory, which is
 * the browser client's default `workDir`, so it follows the override. Any
 * other `~` path is relative to the home directory.
 */
export function expandAppPath(value: string): string {
  const appPrefix = `~/${APP_DATA_DIR}`;
  if (value === appPrefix || value === `${appPrefix}/`) return resolveAppDir();
  if (value.startsWith(`${appPrefix}/`)) {
    return join(resolveAppDir(), value.slice(appPrefix.length + 1));
  }
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}
