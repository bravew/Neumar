import type { AgentMessage } from '@/shared/hooks/useAgent';

// ── Tool name humanization ────────────────────────────────────────────────────

/** Maps normalized (lowercase, no mcp prefix) tool key → static display label */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // PascalCase Claude SDK names (lowercased for lookup)
  bash: 'Shell',
  read: 'Read File',
  write: 'Write File',
  edit: 'Edit File',
  grep: 'Search',
  glob: 'Find Files',
  webfetch: 'Fetch URL',
  websearch: 'Web Search',
  todowrite: 'Update Todos',
  task: 'Subtask',
  // snake_case aliases (non-Claude providers)
  read_file: 'Read File',
  write_file: 'Write File',
  edit_file: 'Edit File',
  search_files: 'Search Files',
  list_directory: 'List Directory',
  list_files: 'List Files',
  web_search: 'Web Search',
  web_fetch: 'Fetch URL',
  computer: 'Computer Use',
};

/** Maps normalized tool key → { running, done } verb labels */
const TOOL_STATUS_LABELS: Record<string, { running: string; done: string }> = {
  bash: { running: 'Running', done: 'Ran' },
  read: { running: 'Reading', done: 'Read' },
  write: { running: 'Writing', done: 'Wrote' },
  edit: { running: 'Editing', done: 'Edited' },
  grep: { running: 'Searching', done: 'Searched' },
  glob: { running: 'Finding', done: 'Found' },
  webfetch: { running: 'Fetching', done: 'Fetched' },
  websearch: { running: 'Searching', done: 'Searched' },
  todowrite: { running: 'Updating', done: 'Updated' },
  task: { running: 'Running', done: 'Ran' },
  read_file: { running: 'Reading', done: 'Read' },
  write_file: { running: 'Writing', done: 'Wrote' },
  edit_file: { running: 'Editing', done: 'Edited' },
  search_files: { running: 'Searching', done: 'Searched' },
  list_directory: { running: 'Listing', done: 'Listed' },
  list_files: { running: 'Listing', done: 'Listed' },
  web_search: { running: 'Searching', done: 'Searched' },
  web_fetch: { running: 'Fetching', done: 'Fetched' },
  computer: { running: 'Acting', done: 'Acted' },
};

const FILE_WRITE_TOOL_KEYS = new Set([
  'write',
  'edit',
  'write_file',
  'edit_file',
  'writefile',
  'editfile',
  'fs.write',
  'file_write',
  'write_to_file',
  'create_file',
  'str_replace_editor',
  'notebookedit',
]);

/** Normalize a raw tool name to the lookup key (lowercase, strip spaces) */
function normalizeToolKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '');
}

/**
 * Strip MCP prefix and return the last segment.
 * "mcp__context7__query-docs" → "query-docs"
 */
function stripMcpPrefix(raw: string): string {
  if (!raw.startsWith('mcp__')) return raw;
  return raw.split('__').at(-1) ?? raw;
}

/**
 * Returns the MCP server name for display, e.g. "mcp__context7__query" → "context7".
 * Returns null for non-MCP tools.
 */
export function getMcpServerName(raw: string): string | null {
  if (!raw.startsWith('mcp__')) return null;
  const parts = raw.split('__');
  return parts[1] ?? null;
}

/**
 * Human-readable static label for a tool.
 * Handles PascalCase SDK names, snake_case names, and MCP prefixed names.
 */
export function humanizeToolName(raw: string): string {
  if (!raw) return 'Tool';
  const withoutMcp = stripMcpPrefix(raw);
  const key = normalizeToolKey(withoutMcp);
  if (TOOL_DISPLAY_NAMES[key]) return TOOL_DISPLAY_NAMES[key];
  // Fallback: snake_case / kebab-case / PascalCase → Title Case words
  return withoutMcp
    .replace(/([A-Z])/g, ' $1') // PascalCase split
    .replace(/[-_]/g, ' ') // kebab/snake split
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ToolStatus = 'running' | 'done' | 'error';

/**
 * Tense-aware verb label. Returns present-tense while running, past-tense when done.
 * Falls back to humanizeToolName() for unknown tools.
 */
export function statusAwareToolLabel(raw: string, status: ToolStatus): string {
  const withoutMcp = stripMcpPrefix(raw);
  const key = normalizeToolKey(withoutMcp);
  const labels = TOOL_STATUS_LABELS[key];
  if (!labels) return humanizeToolName(raw);
  return status === 'running' ? labels.running : labels.done;
}

export function isFileWriteTool(raw: string): boolean {
  const key = normalizeToolKey(stripMcpPrefix(raw));
  return FILE_WRITE_TOOL_KEYS.has(key);
}

export function getFileWritePath(
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return '';
  const value =
    input.file_path ?? input.path ?? input.filePath ?? input.filename ?? '';
  return typeof value === 'string' ? value : '';
}

export function getFileWriteContent(
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return '';
  const value =
    input.content ??
    input.text ??
    input.new_str ??
    input.newString ??
    input.body ??
    '';
  return typeof value === 'string' ? value : '';
}

// ── Existing utilities ────────────────────────────────────────────────────────

// Get full parameter string for display
export function getFullParamString(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return '';

  switch (toolName) {
    case 'Bash':
      return (input.command as string) || '';
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path as string) || '';
    case 'Grep':
    case 'Glob':
      return (input.pattern as string) || '';
    case 'WebFetch':
      return (input.url as string) || '';
    case 'WebSearch':
      return (input.query as string) || '';
    case 'TodoWrite':
      return '';
    case 'Task':
      return (input.description as string) || '';
    default:
      if (isFileWriteTool(toolName)) return getFileWritePath(input);
      return '';
  }
}

// Get truncated param for inline display
export function getTruncatedParam(param: string, maxLen: number = 60): string {
  if (param.length <= maxLen) return param;
  return param.slice(0, maxLen) + '...';
}

// Mask API keys and secrets in displayed text — show only last 4 chars
export function maskSecrets(text: string): string {
  return text.replace(
    /\b(lin_api_|sk-|sk-ant-|ghp_|gho_|ghu_|ghs_|ghr_|xoxb-|xoxp-|xapp-|glpat-|AKIA[A-Z0-9]|Bearer\s+)([A-Za-z0-9_\-/.+=]{8,})/g,
    (_, prefix, rest) =>
      `${prefix}${'*'.repeat(Math.max(rest.length - 4, 4))}${rest.slice(-4)}`,
  );
}

// Check if output is an expected non-fatal message (should be warning, not error)
export function isExpectedWarning(toolName: string, output: string): boolean {
  const lowerOutput = output.toLowerCase();

  if (
    toolName === 'Read' &&
    (lowerOutput.includes('file does not exist') ||
      lowerOutput.includes('no such file') ||
      lowerOutput.includes('file not found'))
  ) {
    return true;
  }

  if (
    (toolName === 'Grep' || toolName === 'Glob') &&
    (lowerOutput.includes('no matches') ||
      lowerOutput.includes('no files found'))
  ) {
    return true;
  }

  return false;
}

/**
 * Parse tool output to produce a concise, tool-specific result summary.
 * Returns null when no specific summary is available (caller uses generic).
 * Only applied in the default: branch of getResultInfo() — existing named cases
 * (Bash, Read, Write, etc.) are handled by their own switch arms.
 */
function getToolSpecificSummary(
  toolName: string,
  output: string,
): string | null {
  const key = normalizeToolKey(stripMcpPrefix(toolName));

  // bash / shell — extract exit code
  if (key === 'bash' || key === 'shell') {
    const m =
      output.match(/exit[_\s]code[:\s]+(\d+)/i) ??
      output.match(/\(exit (\d+)\)/i);
    if (m) return m[1] === '0' ? 'exit 0' : `exit ${m[1]}`;
    if (/error:|fatal:|command not found/i.test(output)) return 'error';
  }

  // list_directory
  if (key === 'list_directory' || key === 'list_files') {
    const entries = output.split('\n').filter(Boolean).length;
    return `${entries} item${entries === 1 ? '' : 's'}`;
  }

  // web_search
  if (key === 'web_search' || key === 'websearch') {
    const m = output.match(/(\d+)\s+result/i);
    return m ? `${m[1]} results` : null;
  }

  return null;
}

// Parse result to get content info
export function getResultInfo(
  toolName: string,
  result: AgentMessage | undefined,
  t: { task: Record<string, string> },
): { hasContent: boolean; summary: string; isWarning: boolean } {
  if (!result) {
    return { hasContent: false, summary: t.task.toolRunning, isWarning: false };
  }

  let output = result.output || result.content || '';

  const toolUseErrorMatch = output.match(
    /<tool_use_error>([\s\S]*?)<\/tool_use_error>/,
  );
  if (toolUseErrorMatch) {
    output = toolUseErrorMatch[1].trim();
  }

  const isError = !!result.isError;
  const isWarning = isExpectedWarning(toolName, output);

  if (isError) {
    const firstLine = output.split('\n').find((l) => l.trim()) || output;
    const truncated =
      firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;
    return {
      hasContent: true,
      summary: truncated || t.task.toolErrorOccurred,
      isWarning,
    };
  }

  if (!output || output.trim() === '') {
    return {
      hasContent: false,
      summary: t.task.toolNoContent,
      isWarning: false,
    };
  }

  const lines = output.split('\n').filter((l) => l.trim());
  const lineCount = lines.length;

  switch (toolName) {
    case 'Bash':
      if (lineCount === 0)
        return {
          hasContent: false,
          summary: t.task.toolNoOutput,
          isWarning: false,
        };
      if (lineCount === 1)
        return {
          hasContent: true,
          summary: lines[0].slice(0, 80),
          isWarning: false,
        };
      return {
        hasContent: true,
        summary: t.task.toolLinesOfOutput.replace('{count}', String(lineCount)),
        isWarning: false,
      };

    case 'Read':
      return {
        hasContent: true,
        summary: t.task.toolReadLines.replace('{count}', String(lineCount)),
        isWarning: false,
      };

    case 'Write':
      return {
        hasContent: true,
        summary: t.task.toolFileCreated,
        isWarning: false,
      };

    case 'Edit':
      return {
        hasContent: true,
        summary: t.task.toolFileModified,
        isWarning: false,
      };

    case 'Grep':
      if (lineCount === 0)
        return {
          hasContent: false,
          summary: t.task.toolNoMatchesFound,
          isWarning: false,
        };
      return {
        hasContent: true,
        summary: t.task.toolFoundMatches.replace('{count}', String(lineCount)),
        isWarning: false,
      };

    case 'Glob':
      if (lineCount === 0)
        return {
          hasContent: false,
          summary: t.task.toolNoFilesFound,
          isWarning: false,
        };
      return {
        hasContent: true,
        summary: t.task.toolFoundFiles.replace('{count}', String(lineCount)),
        isWarning: false,
      };

    case 'WebFetch':
      return {
        hasContent: true,
        summary: t.task.toolFetchedChars.replace(
          '{count}',
          String(output.length),
        ),
        isWarning: false,
      };

    case 'WebSearch':
      return {
        hasContent: true,
        summary: t.task.toolSearchCompleted,
        isWarning: false,
      };

    case 'TodoWrite':
      return {
        hasContent: true,
        summary: t.task.toolTodoUpdated,
        isWarning: false,
      };

    case 'Task':
      return {
        hasContent: true,
        summary: t.task.toolSubtaskCompleted,
        isWarning: false,
      };

    default: {
      if (isFileWriteTool(toolName)) {
        return {
          hasContent: true,
          summary: t.task.toolFileCreated,
          isWarning: false,
        };
      }
      const specific = getToolSpecificSummary(toolName, output);
      if (specific) {
        return { hasContent: true, summary: specific, isWarning: false };
      }
      return {
        hasContent: lineCount > 0,
        summary:
          lineCount > 0
            ? t.task.toolLines.replace('{count}', String(lineCount))
            : t.task.toolNoContent,
        isWarning: false,
      };
    }
  }
}

// Check if a value is a flat key-value object (no nested objects/arrays)
export function isFlatObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => v === null || typeof v !== 'object',
  );
}

// Try to parse a string as JSON
export function tryParseJSON(text: string): unknown | null {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch {
    // not JSON
  }
  return null;
}

// Format a value for table cell display
export function formatCellValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') {
    if (value.length > 120) return value.slice(0, 120) + '...';
    return value;
  }
  return String(value);
}
