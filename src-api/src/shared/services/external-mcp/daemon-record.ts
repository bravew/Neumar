import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getAppDataDir } from '@/shared/utils/paths';

export const MCP_DAEMON_RECORD_FILE = 'mcp-daemon.json';

export interface McpDaemonRecord {
  url: string;
  pid: number;
  startedAt: string;
}

export function getDaemonRecordPath(): string {
  return path.join(getAppDataDir(), MCP_DAEMON_RECORD_FILE);
}

export function writeDaemonRecord(url: string): McpDaemonRecord {
  const record: McpDaemonRecord = {
    url,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(getDaemonRecordPath(), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function readDaemonRecord(): McpDaemonRecord | null {
  const recordPath = getDaemonRecordPath();
  if (!existsSync(recordPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(recordPath, 'utf8')) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as McpDaemonRecord).url !== 'string'
    ) {
      return null;
    }
    return parsed as McpDaemonRecord;
  } catch {
    return null;
  }
}
