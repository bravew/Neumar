/**
 * OpenAI-Compatible Agent Tools
 *
 * Tool definitions and executors for the OpenAI-compatible agentic loop.
 * Provides core file system and shell tools using OpenAI function calling format.
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

import {
  evaluateFilesystemPermission,
  filterPermittedFilesystemPaths,
  loadPermissionRules,
} from '@/core/agent/permission-rules';
import type {
  FilesystemOperation,
  FilesystemPermissionRule,
} from '@/core/agent/tool-permission-registry';

import { executeConnectorTool } from '@/shared/connectors/binder';
import { isSearchEnabled, search } from '@/shared/services/search';
import { errorMessage } from '@/shared/utils/errors';

import { generateImage, generateVideo } from './media';

// ============================================================================
// Tool Definitions (OpenAI function calling format)
// ============================================================================

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the contents of a file. Returns the file content with line numbers. Supports offset and limit for reading portions of large files.\nReturns: { content: "1\\tline1\\n2\\tline2\\n..." } with tab-separated line numbers.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-based)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write content to a file. Creates parent directories if they do not exist. Overwrites existing file content.\nReturns: "File written: <path>" on success.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace and indentation).\nReturns: "File edited: <path>" on success, or error if old_string not found or not unique.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact string to find and replace',
          },
          new_string: {
            type: 'string',
            description: 'The replacement string',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description:
        'Find files matching a glob pattern. Returns a list of matching file paths.\nReturns: newline-separated absolute file paths, or "No files matched the pattern."',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")',
          },
          path: {
            type: 'string',
            description:
              'Directory to search in (defaults to working directory)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Search file contents using a regular expression pattern. Returns matching lines with file paths and line numbers.\nReturns: lines in format "<filepath>:<lineNumber>:<matchingLine>", or "No matches found."',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regular expression pattern to search for',
          },
          path: {
            type: 'string',
            description:
              'File or directory to search in (defaults to working directory)',
          },
          include: {
            type: 'string',
            description: 'Glob pattern to filter files (e.g., "*.ts")',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Execute a shell command. Returns stdout and stderr. Use for system commands, git operations, and other terminal tasks.\nReturns: stdout content, with "STDERR: ..." appended if stderr is present. Times out after 120 seconds.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an image from a text prompt using the Seedream image generation model. Returns the file path of the generated image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the image to generate',
          },
          model: {
            type: 'string',
            description: 'Seedream model to use (default: seedream-4-5-251128)',
          },
          size: {
            type: 'string',
            description: 'Image size (default: "2K")',
          },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description:
        'Generate a video from a text prompt using the Seedance video generation model. Supports optional image input for image-to-video. Returns the file path of the generated video.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the video to generate',
          },
          model: {
            type: 'string',
            description: 'Seedance model to use (default: seedance-2-0)',
          },
          image_url: {
            type: 'string',
            description: 'Optional image URL for image-to-video generation',
          },
        },
        required: ['prompt'],
      },
    },
  },
];

// ============================================================================
// Search Tools (conditionally appended when search service is enabled)
// ============================================================================

const SEARCH_TOOL_DEFS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current information. Returns titles, URLs, snippets, and optionally full content and AI-generated answers.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results (1-10, default: 5)',
          },
          freshness: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
            description: 'Limit results to a recent time period',
          },
          country: {
            type: 'string',
            description: 'Country code for regional results (e.g., "US", "CN")',
          },
          language: {
            type: 'string',
            description: 'Language code for results (e.g., "en", "zh")',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search_news',
      description:
        'Search for recent news articles on a topic. Automatically filters to the past week.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The news search query',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results (1-10, default: 5)',
          },
          country: {
            type: 'string',
            description: 'Country code for regional news',
          },
        },
        required: ['query'],
      },
    },
  },
];

/** Cached merged tool list (search state doesn't change mid-conversation). */
let cachedToolDefs: ChatCompletionTool[] | null = null;
let cachedSearchEnabled: boolean | null = null;

/**
 * Get the full list of tool definitions, including search tools
 * if the search service is enabled. Cached to avoid per-iteration allocation.
 */
export function getToolDefinitions(): ChatCompletionTool[] {
  const searchOn = isSearchEnabled();
  if (cachedToolDefs && cachedSearchEnabled === searchOn) return cachedToolDefs;
  cachedSearchEnabled = searchOn;
  cachedToolDefs = searchOn
    ? [...TOOL_DEFINITIONS, ...SEARCH_TOOL_DEFS]
    : TOOL_DEFINITIONS;
  return cachedToolDefs;
}

// ============================================================================
// Tool Result Type
// ============================================================================

export interface ToolResult {
  output: string;
  isError: boolean;
}

// ============================================================================
// Path Validation
// ============================================================================

function loadFilesystemRules(): FilesystemPermissionRule[] {
  try {
    return loadPermissionRules().filesystem ?? [];
  } catch {
    return [];
  }
}

function validatePath(
  filePath: string,
  workDir: string,
  operation: FilesystemOperation,
  rules: FilesystemPermissionRule[] = loadFilesystemRules(),
): string {
  const resolved = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(workDir, filePath);
  const workDirResolved = resolve(workDir);
  const permission = evaluateFilesystemPermission({
    workspaceRoot: workDirResolved,
    targetPath: resolved,
    operation,
    rules,
  });
  if (!permission.allowed) {
    throw new Error(`permission_denied: ${permission.reason}`);
  }
  return resolved;
}

// ============================================================================
// Tool Executors
// ============================================================================

async function readFile(
  args: { file_path: string; offset?: number; limit?: number },
  workDir: string,
): Promise<ToolResult> {
  try {
    const filePath = validatePath(args.file_path, workDir, 'read');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const offset = Math.max(0, (args.offset || 1) - 1);
    const limit = args.limit || lines.length;
    const selected = lines.slice(offset, offset + limit);

    const numbered = selected
      .map((line, i) => `${offset + i + 1}\t${line}`)
      .join('\n');

    return { output: numbered, isError: false };
  } catch (error) {
    return {
      output: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

async function writeFile(
  args: { file_path: string; content: string },
  workDir: string,
): Promise<ToolResult> {
  try {
    const filePath = validatePath(args.file_path, workDir, 'write');
    const dir = join(filePath, '..');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, args.content, 'utf-8');
    return { output: `File written: ${filePath}`, isError: false };
  } catch (error) {
    return {
      output: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

async function editFile(
  args: { file_path: string; old_string: string; new_string: string },
  workDir: string,
): Promise<ToolResult> {
  try {
    const filePath = validatePath(args.file_path, workDir, 'write');
    const content = await fs.readFile(filePath, 'utf-8');

    if (!content.includes(args.old_string)) {
      return {
        output: `Error: old_string not found in ${filePath}. Make sure it matches exactly including whitespace.`,
        isError: true,
      };
    }

    const occurrences = content.split(args.old_string).length - 1;
    if (occurrences > 1) {
      return {
        output: `Error: old_string found ${occurrences} times in ${filePath}. Provide more context to make the match unique.`,
        isError: true,
      };
    }

    const newContent = content.replace(args.old_string, args.new_string);
    await fs.writeFile(filePath, newContent, 'utf-8');
    return { output: `File edited: ${filePath}`, isError: false };
  } catch (error) {
    return {
      output: `Error editing file: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

async function globFiles(
  args: { pattern: string; path?: string },
  workDir: string,
): Promise<ToolResult> {
  try {
    const rules = loadFilesystemRules();
    const searchDir = validatePath(
      args.path ?? workDir,
      workDir,
      'glob',
      rules,
    );

    // Use recursive readdir and match against pattern
    const allFiles = filterPermittedFilesystemPaths(await walkDir(searchDir), {
      workspaceRoot: workDir,
      operation: 'glob',
      rules,
    });

    // Simple glob matching
    const pattern = args.pattern;
    const matched = allFiles.filter((f) => {
      const rel = relative(searchDir, f);
      return matchGlob(pattern, rel);
    });

    if (matched.length === 0) {
      return { output: 'No files matched the pattern.', isError: false };
    }

    return { output: matched.join('\n'), isError: false };
  } catch (error) {
    return {
      output: `Error globbing: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await walkDir(fullPath)));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}

function matchGlob(pattern: string, filepath: string): boolean {
  // Convert glob pattern to regex
  let regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*')
    .replace(/\?/g, '[^/]');

  // If pattern doesn't start with **, match from beginning
  if (!pattern.startsWith('**')) {
    regex = '^' + regex;
  }
  regex = regex + '$';

  return new RegExp(regex).test(filepath);
}

async function grepFiles(
  args: { pattern: string; path?: string; include?: string },
  workDir: string,
): Promise<ToolResult> {
  try {
    const rules = loadFilesystemRules();
    const searchDir = validatePath(
      args.path ?? workDir,
      workDir,
      'grep',
      rules,
    );
    const regex = new RegExp(args.pattern);

    let files: string[];
    // Check if path is a file
    try {
      const stat = await fs.stat(searchDir);
      if (stat.isFile()) {
        files = filterPermittedFilesystemPaths([searchDir], {
          workspaceRoot: workDir,
          operation: 'grep',
          rules,
        });
      } else {
        files = filterPermittedFilesystemPaths(await walkDir(searchDir), {
          workspaceRoot: workDir,
          operation: 'grep',
          rules,
        });
      }
    } catch {
      files = filterPermittedFilesystemPaths(await walkDir(searchDir), {
        workspaceRoot: workDir,
        operation: 'grep',
        rules,
      });
    }

    // Filter by include pattern if provided
    if (args.include) {
      files = files.filter((f) => {
        const rel = relative(workDir, f);
        return (
          matchGlob(args.include!, rel) ||
          f.endsWith(args.include!.replace('*', ''))
        );
      });
    }

    const results: string[] = [];
    const maxResults = 100;

    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (regex.test(lines[i]!)) {
            results.push(`${file}:${i + 1}:${lines[i]}`);
          }
        }
      } catch {
        // Skip binary/unreadable files
      }
    }

    if (results.length === 0) {
      return { output: 'No matches found.', isError: false };
    }

    return { output: results.join('\n'), isError: false };
  } catch (error) {
    return {
      output: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

function executeBash(
  args: { command: string },
  workDir: string,
  abortSignal?: AbortSignal,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = exec(
      args.command,
      {
        cwd: workDir,
        timeout: 120_000,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        env: { ...process.env, HOME: process.env.HOME },
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve({
            output: 'Command timed out after 120 seconds.',
            isError: true,
          });
          return;
        }
        const output = [
          stdout ? stdout.trim() : '',
          stderr ? `STDERR: ${stderr.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        resolve({
          output:
            output || (error ? `Exit code: ${error.code}` : '(no output)'),
          isError: !!error,
        });
      },
    );

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        child.kill('SIGTERM');
      });
    }
  });
}

// ============================================================================
// Main Executor
// ============================================================================

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workDir: string,
  abortSignal?: AbortSignal,
  agentConfig?: { apiKey?: string; baseUrl?: string },
): Promise<ToolResult> {
  switch (name) {
    case 'read_file':
      return readFile(
        args as { file_path: string; offset?: number; limit?: number },
        workDir,
      );
    case 'write_file':
      return writeFile(args as { file_path: string; content: string }, workDir);
    case 'edit_file':
      return editFile(
        args as { file_path: string; old_string: string; new_string: string },
        workDir,
      );
    case 'glob':
      return globFiles(args as { pattern: string; path?: string }, workDir);
    case 'grep':
      return grepFiles(
        args as { pattern: string; path?: string; include?: string },
        workDir,
      );
    case 'bash':
      return executeBash(args as { command: string }, workDir, abortSignal);
    case 'generate_image':
      return generateImage(
        args.prompt as string,
        workDir,
        agentConfig?.apiKey || '',
        agentConfig?.baseUrl || '',
        args.model as string | undefined,
        args.size as string | undefined,
      );
    case 'generate_video':
      return generateVideo(
        args.prompt as string,
        workDir,
        agentConfig?.apiKey || '',
        agentConfig?.baseUrl || '',
        args.model as string | undefined,
        args.image_url as string | undefined,
        abortSignal,
      );
    case 'web_search':
      return executeWebSearch(args);
    case 'web_search_news':
      return executeWebSearchNews(args);
    default:
      if (isConnectorToolName(name)) {
        return executeOpenAIConnectorTool(name, args, workDir, abortSignal);
      }
      return { output: `Unknown tool: ${name}`, isError: true };
  }
}

async function executeOpenAIConnectorTool(
  name: string,
  args: Record<string, unknown>,
  workDir: string,
  abortSignal?: AbortSignal,
): Promise<ToolResult> {
  try {
    const result = await executeConnectorTool({
      connectorId: connectorIdFromToolName(name),
      toolName: name,
      input: args,
      context: {
        runId: 'openai-compat',
        surface: 'desktop',
        platform: 'desktop',
        accountId: 'default',
        permissionTier: 'admin',
        workDir,
        abortSignal,
      },
    });
    return {
      output: JSON.stringify(result),
      isError: false,
    };
  } catch (error) {
    return {
      output: `Connector tool failed: ${errorMessage(error)}`,
      isError: true,
    };
  }
}

function isConnectorToolName(name: string): boolean {
  return /^[a-z][a-z0-9_-]*\.[a-z0-9_.-]+$/i.test(name);
}

function connectorIdFromToolName(name: string): string {
  return name.slice(0, name.indexOf('.'));
}

async function executeWebSearch(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!args.query || typeof args.query !== 'string') {
    return { output: 'Missing required parameter: query', isError: true };
  }
  try {
    const response = await search({
      query: args.query,
      maxResults: args.max_results as number | undefined,
      freshness: args.freshness as
        | 'day'
        | 'week'
        | 'month'
        | 'year'
        | undefined,
      country: args.country as string | undefined,
      language: args.language as string | undefined,
    });
    const lines: string[] = [];
    if (response.answer) lines.push(`Answer: ${response.answer}\n`);
    for (const r of response.results) {
      lines.push(`${r.title}\n${r.url}\n${r.snippet}\n`);
    }
    return { output: lines.join('\n') || 'No results found.', isError: false };
  } catch (err) {
    return {
      output: `Search failed: ${errorMessage(err)}`,
      isError: true,
    };
  }
}

async function executeWebSearchNews(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!args.query || typeof args.query !== 'string') {
    return { output: 'Missing required parameter: query', isError: true };
  }
  try {
    const response = await search({
      query: args.query,
      maxResults: args.max_results as number | undefined,
      type: 'news',
      country: args.country as string | undefined,
      freshness: 'week',
    });
    const lines: string[] = [];
    for (const r of response.results) {
      lines.push(
        `${r.title}\n${r.url}\n${r.publishedDate ?? ''}\n${r.snippet}\n`,
      );
    }
    return {
      output: lines.join('\n') || 'No news results found.',
      isError: false,
    };
  } catch (err) {
    return {
      output: `News search failed: ${errorMessage(err)}`,
      isError: true,
    };
  }
}
