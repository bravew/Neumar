import {
  Code,
  FileText,
  Globe,
  Monitor,
  Pencil,
  Search,
  Terminal,
} from 'lucide-react';

import type { AgentMessage } from '@/shared/hooks/useAgent';

// Step output type definition
export interface StepOutput {
  index: number;
  toolName: string;
  toolIcon: 'terminal' | 'file' | 'edit' | 'search' | 'globe' | 'code';
  description: string;
  input?: Record<string, unknown>;
  content: {
    type: 'markdown' | 'code' | 'terminal' | 'json' | 'text';
    value: string;
    filename?: string;
    language?: string;
  } | null;
}

// Tool icon mapping
const toolIconMap: Record<string, StepOutput['toolIcon']> = {
  Read: 'file',
  Write: 'file',
  Edit: 'edit',
  Bash: 'terminal',
  Grep: 'search',
  Glob: 'search',
  WebFetch: 'globe',
  WebSearch: 'globe',
  LSP: 'code',
};

// Get icon component based on tool type
export function getToolIcon(iconType: StepOutput['toolIcon']) {
  switch (iconType) {
    case 'terminal':
      return Terminal;
    case 'file':
      return FileText;
    case 'edit':
      return Pencil;
    case 'search':
      return Search;
    case 'globe':
      return Globe;
    case 'code':
      return Code;
    default:
      return Monitor;
  }
}

// Get file extension language
export function getLanguageFromFilename(filename?: string): string {
  if (!filename) return 'text';
  const ext = filename.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
  };
  return langMap[ext || ''] || 'text';
}

// Extract step outputs from messages
export function extractStepOutputs(
  messages: AgentMessage[],
  tt: Record<string, string>,
): StepOutput[] {
  const toolResultMessages: AgentMessage[] = [];
  messages.forEach((msg) => {
    if (msg.type === 'tool_result') {
      toolResultMessages.push(msg);
    }
  });

  return messages
    .filter((m) => m.type === 'tool_use' && m.name)
    .map((m, index) => {
      const input = m.input as Record<string, unknown> | undefined;
      const toolName = m.name || 'Unknown';
      const toolIcon = toolIconMap[toolName] || 'code';

      const toolResult = toolResultMessages[index];
      const output = toolResult?.output || '';

      let description: string;
      let content: StepOutput['content'];

      switch (toolName) {
        case 'Read': {
          const filePath = input?.file_path as string | undefined;
          const filename = filePath?.split('/').pop() || 'file';
          description = tt.vcReadingFile.replace('{file}', filename);
          content = {
            type: 'code',
            value:
              output ||
              `// ${tt.vcReadingFile.replace('{file}', filePath || 'unknown')}`,
            filename,
            language: getLanguageFromFilename(filename),
          };
          break;
        }
        case 'Write': {
          const filePath = input?.file_path as string | undefined;
          const fileContent = input?.content as string | undefined;
          const filename = filePath?.split('/').pop() || 'file';
          description = tt.vcCreatingFile.replace('{file}', filename);
          content = {
            type: 'code',
            value: fileContent || '',
            filename,
            language: getLanguageFromFilename(filename),
          };
          break;
        }
        case 'Edit': {
          const filePath = input?.file_path as string | undefined;
          const oldStr = input?.old_string as string | undefined;
          const newStr = input?.new_string as string | undefined;
          const filename = filePath?.split('/').pop() || 'file';
          description = tt.vcEditingFile.replace('{file}', filename);
          content = {
            type: 'code',
            value: `// Replacing:\n${oldStr || ''}\n\n// With:\n${newStr || ''}`,
            filename,
            language: getLanguageFromFilename(filename),
          };
          break;
        }
        case 'Bash': {
          const command = input?.command as string | undefined;
          description = tt.vcRunningCommand;
          content = {
            type: 'terminal',
            value: output
              ? `$ ${command || ''}\n${output}`
              : `$ ${command || ''}`,
          };
          break;
        }
        case 'Grep': {
          const pattern = input?.pattern as string | undefined;
          description = tt.vcSearchingFor.replace('{pattern}', pattern || '');
          content = {
            type: 'text',
            value: output || pattern || '',
          };
          break;
        }
        case 'Glob': {
          const pattern = input?.pattern as string | undefined;
          description = tt.vcFindingFiles.replace('{pattern}', pattern || '');
          content = {
            type: 'text',
            value: output || pattern || '',
          };
          break;
        }
        case 'WebFetch': {
          const url = input?.url as string | undefined;
          description = tt.vcFetching.replace(
            '{url}',
            url?.slice(0, 30) || 'URL',
          );
          content = {
            type: 'markdown',
            value: output || url || '',
          };
          break;
        }
        case 'WebSearch': {
          const query = input?.query as string | undefined;
          description = tt.vcSearchingWeb.replace('{query}', query || '');
          content = {
            type: 'text',
            value: output || query || '',
          };
          break;
        }
        default: {
          description = tt.vcUsingTool.replace('{tool}', toolName);
          content = output
            ? { type: 'text', value: output }
            : input
              ? {
                  type: 'json',
                  value: JSON.stringify(input, null, 2),
                }
              : null;
        }
      }

      return {
        index,
        toolName,
        toolIcon,
        description,
        input,
        content,
      };
    });
}

// Get tool action description — uses standalone vcAction* keys
export function getToolActionText(
  toolName: string,
  tt: Record<string, string>,
  input?: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = input?.command as string | undefined;
      const truncCmd = cmd
        ? `${cmd.slice(0, 40)}${cmd.length > 40 ? '...' : ''}`
        : '...';
      return `${tt.vcExecutingCommand}  ${truncCmd}`;
    }
    case 'Read':
      return `${tt.vcActionReading}  ${(input?.file_path as string)?.split('/').pop() || 'file'}`;
    case 'Write':
      return `${tt.vcActionWriting}  ${(input?.file_path as string)?.split('/').pop() || 'file'}`;
    case 'Edit':
      return `${tt.vcActionEditing}  ${(input?.file_path as string)?.split('/').pop() || 'file'}`;
    case 'Grep':
      return `${tt.vcActionSearching}  "${input?.pattern || ''}"`;
    case 'Glob':
      return `${tt.vcActionFindingFiles}  "${input?.pattern || ''}"`;
    case 'WebFetch':
      return `${tt.vcActionFetching}  ${(input?.url as string)?.slice(0, 30) || 'URL'}...`;
    case 'WebSearch':
      return `${tt.vcActionSearchingWeb}  "${input?.query || ''}"`;
    default:
      return tt.vcUsingTool.replace('{tool}', toolName);
  }
}

// Get tool type label
export function getToolTypeLabel(
  toolName: string,
  tt: Record<string, string>,
): string {
  switch (toolName) {
    case 'Bash':
      return tt.vcToolTerminal;
    case 'Read':
    case 'Write':
      return tt.vcToolFile;
    case 'Edit':
      return tt.vcToolEditor;
    case 'Grep':
    case 'Glob':
      return tt.vcToolSearch;
    case 'WebFetch':
    case 'WebSearch':
      return tt.vcToolBrowser;
    default:
      return tt.vcToolGeneric;
  }
}
