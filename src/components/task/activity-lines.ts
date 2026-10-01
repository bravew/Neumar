import { toDisplayPath } from '@/shared/lib/toDisplayPath';

export type ActivityKind =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'web'
  | 'search'
  | 'mcp'
  | 'approval'
  | 'other';

export interface ActivityEvent {
  type: string;
  name?: string;
  id?: string;
  input?: unknown;
  permission?: {
    description?: string;
    command?: string;
    tool?: string;
  };
}

export interface ActivityLine {
  id: string;
  kind: ActivityKind;
  /** Short name shown in the sentence (display path, command, url, or tool). */
  label: string;
  /** Absolute path used by open, reveal, and copy. */
  path?: string;
  /** Write and edit lines link to the file diff. */
  linksToDiff: boolean;
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  return input as Record<string, unknown>;
}

function stringField(
  input: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function displayPath(path: string, sessionRoot?: string): string {
  return toDisplayPath(path, sessionRoot);
}

function commandLabel(command: string): string {
  const token = command.trim().split(/\s+/)[0] ?? command.trim();
  const base = token.split('/').pop() || token;
  return base || command.trim();
}

function mcpLabel(toolName: string): string {
  const parts = toolName.split('__');
  return parts[2] || parts[1] || toolName;
}

function firstAbsolutePath(command: string): string | undefined {
  const match = command.match(/(?:^|\s)((?:\/|~\/)[^\s'"]+)/);
  return match?.[1];
}

export function mapActivityLines(
  messages: ActivityEvent[],
  sessionRoot?: string,
): ActivityLine[] {
  const lines: ActivityLine[] = [];

  messages.forEach((message, index) => {
    if (message.type === 'permission_request') {
      const description = message.permission?.description?.trim();
      if (!description) return;
      lines.push({
        id: message.id || `approval-${index}`,
        kind: 'approval',
        label: description,
        linksToDiff: false,
      });
      return;
    }

    if (message.type !== 'tool_use') return;
    const name = message.name || 'tool';
    const input = asRecord(message.input);
    const id = message.id || `tool-${index}`;

    if (name.startsWith('mcp__')) {
      lines.push({
        id,
        kind: 'mcp',
        label: mcpLabel(name),
        linksToDiff: false,
      });
      return;
    }

    switch (name) {
      case 'Read': {
        const path = stringField(input, ['file_path', 'path']);
        lines.push({
          id,
          kind: 'read',
          label: path ? displayPath(path, sessionRoot) : name,
          path,
          linksToDiff: false,
        });
        return;
      }
      case 'Write':
      case 'Edit': {
        const path = stringField(input, ['file_path', 'path']);
        lines.push({
          id,
          kind: name === 'Write' ? 'write' : 'edit',
          label: path ? displayPath(path, sessionRoot) : name,
          path,
          linksToDiff: Boolean(path),
        });
        return;
      }
      case 'Bash': {
        const command = stringField(input, ['command']) ?? name;
        const path = firstAbsolutePath(command);
        lines.push({
          id,
          kind: 'bash',
          label: commandLabel(command),
          path,
          linksToDiff: false,
        });
        return;
      }
      case 'WebFetch': {
        lines.push({
          id,
          kind: 'web',
          label: stringField(input, ['url', 'uri']) ?? name,
          linksToDiff: false,
        });
        return;
      }
      case 'WebSearch':
      case 'Grep':
      case 'Glob': {
        const query =
          stringField(input, ['query', 'pattern', 'glob_pattern']) ??
          stringField(input, ['path']) ??
          name;
        const path = stringField(input, ['path', 'file_path']);
        lines.push({
          id,
          kind: 'search',
          label: query,
          path,
          linksToDiff: false,
        });
        return;
      }
      default: {
        lines.push({
          id,
          kind: 'other',
          label: name,
          linksToDiff: false,
        });
      }
    }
  });

  return lines;
}
