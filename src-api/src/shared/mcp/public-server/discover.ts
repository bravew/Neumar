import { DEFAULT_API_PORT } from '@/config/constants';
import { classifyIp } from '@/shared/network-policy/ip';
import { readDaemonRecord } from '@/shared/services/external-mcp/daemon-record';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackDaemonUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return classifyIp(host)?.classification === 'loopback';
}

export function defaultDaemonUrl(): string {
  const port =
    Number(process.env.PORT) ||
    (process.env.NODE_ENV === 'production' ? DEFAULT_API_PORT : 5126);
  return `http://127.0.0.1:${port}`;
}

export function resolveDaemonUrl(cliUrl?: string): string {
  if (cliUrl) {
    if (!isLoopbackDaemonUrl(cliUrl)) {
      throw new Error(
        `Refusing non-loopback --daemon-url: ${cliUrl}. Use http://127.0.0.1:<port>.`,
      );
    }
    return cliUrl.replace(/\/$/, '');
  }
  const record = readDaemonRecord();
  if (record?.url && isLoopbackDaemonUrl(record.url)) {
    return record.url.replace(/\/$/, '');
  }
  return defaultDaemonUrl();
}

export function refreshDaemonUrl(current: string): string {
  const record = readDaemonRecord();
  if (record?.url && isLoopbackDaemonUrl(record.url)) {
    return record.url.replace(/\/$/, '');
  }
  return current;
}
