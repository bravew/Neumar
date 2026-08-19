import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  File,
  FileCode2,
  FileEdit,
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  FolderSearch,
  Globe,
  Layers,
  ListTodo,
  Music,
  Package,
  Presentation,
  Search,
  Sparkles,
  Table,
  Terminal,
  Type,
  Video,
  Wrench,
  X,
} from 'lucide-react';

import {
  getArtifactTypeFromExt,
  type Artifact,
  type ArtifactType,
} from '@/components/artifacts';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { API_BASE_URL } from '@/config';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useTraceStream } from '@/shared/hooks/useTraceStream';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { DocumentPanel } from './DocumentPanel';
import { FileDiffViewer } from './FileDiffViewer';
import { TraceMetricsSummary } from './trace/TraceMetricsSummary';

/** Check if an error message indicates a directory/file not found (non-error state) */
function isNotFoundError(message: string): boolean {
  return (
    message.includes('ENOENT') ||
    message.includes('not found') ||
    message.includes('does not exist')
  );
}

// Re-export types for backwards compatibility
export type { Artifact, ArtifactType };

interface ToolUsage {
  id: string;
  name: string;
  displayName: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  timestamp: number;
}

interface WorkingFile {
  name: string;
  path: string;
  isDir: boolean;
  children?: WorkingFile[];
  isExpanded?: boolean;
}

interface RightSidebarProps {
  messages: AgentMessage[];
  artifacts: Artifact[];
  selectedArtifact: Artifact | null;
  onSelectArtifact: (artifact: Artifact) => void;
  workingDir?: string;
  onSelectWorkingFile?: (file: WorkingFile) => void;
  filesVersion?: number;
  taskId?: string;
  isRunning?: boolean;
}

// Get file icon based on file extension
function getFileIconByExt(ext?: string) {
  if (!ext) return File;
  switch (ext) {
    case 'html':
    case 'htm':
      return FileCode2;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return FileCode2;
    case 'css':
    case 'scss':
    case 'less':
      return FileCode2;
    case 'json':
      return FileText;
    case 'md':
    case 'markdown':
      return FileType;
    case 'csv':
      return Table;
    case 'xlsx':
    case 'xls':
      return FileSpreadsheet;
    case 'pptx':
    case 'ppt':
      return Presentation;
    case 'docx':
    case 'doc':
      return FileText;
    case 'pdf':
      return FileText;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
      return FileImage;
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
    case 'flac':
    case 'wma':
    case 'aud':
    case 'aiff':
    case 'mid':
    case 'midi':
      return Music;
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'm4v':
    case 'wmv':
    case 'flv':
    case '3gp':
      return Video;
    case 'ttf':
    case 'otf':
    case 'woff':
    case 'woff2':
    case 'eot':
      return Type;
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
      return FileCode2;
    default:
      return File;
  }
}

// File types that should NOT read content (binary/streaming files)
const SKIP_CONTENT_TYPES: ArtifactType[] = [
  'audio',
  'video',
  'font',
  'image',
  'pdf',
  'spreadsheet',
  'presentation',
  'document',
];

// Get tool icon based on tool name
function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'Bash':
      return Terminal;
    case 'Read':
      return FileText;
    case 'Write':
      return FileEdit;
    case 'Edit':
      return FileEdit;
    case 'Grep':
      return Search;
    case 'Glob':
      return FolderSearch;
    case 'WebFetch':
    case 'WebSearch':
      return Globe;
    case 'TodoWrite':
      return ListTodo;
    case 'Task':
      return Layers;
    case 'LSP':
      return Code2;
    default:
      return Wrench;
  }
}

// Check if a tool is an MCP tool
function isMcpTool(toolName: string): boolean {
  // MCP tools start with mcp__
  return toolName.startsWith('mcp__');
}

// Check if a tool is a Skill invocation
function isSkillTool(toolName: string): boolean {
  return toolName === 'Skill';
}

// Get display info for skill/MCP
function getSkillMCPInfo(
  toolName: string,
  tt: Record<string, string>,
): { name: string; category: string } {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const serverName = parts[1] || 'unknown';
    const tool = parts[2] || '';
    return {
      name: tool || serverName,
      category: serverName,
    };
  }
  switch (toolName) {
    case 'WebSearch':
      return { name: tt.toolCatWebSearch, category: tt.toolCatSearch };
    case 'WebFetch':
      return { name: tt.toolCatWebFetch, category: tt.toolCatWeb };
    case 'Skill':
      return { name: tt.toolCatSkill, category: tt.toolCatSkills };
    case 'Task':
      return { name: tt.toolCatSubAgent, category: tt.toolCatAgent };
    default:
      return { name: toolName, category: tt.toolCatTool };
  }
}

// Extract MCP tools from messages
function extractMcpTools(
  messages: AgentMessage[],
  tt: Record<string, string>,
): ToolUsage[] {
  const tools: ToolUsage[] = [];
  const toolUseMessages = messages.filter(
    (m) => m.type === 'tool_use' && isMcpTool(m.name || ''),
  );
  const toolResultMessages = messages.filter((m) => m.type === 'tool_result');

  // Create a map of tool results by toolUseId
  const resultMap = new Map<string, { output: string; isError: boolean }>();
  toolResultMessages.forEach((msg) => {
    if (msg.toolUseId) {
      resultMap.set(msg.toolUseId, {
        output: msg.output || '',
        isError: msg.isError || false,
      });
    }
  });

  toolUseMessages.forEach((msg, index) => {
    const toolName = msg.name || 'Unknown';
    const toolId = msg.id || `tool-${index}`;
    const result = resultMap.get(toolId);
    const info = getSkillMCPInfo(toolName, tt);

    tools.push({
      id: toolId,
      name: toolName,
      displayName: info.name,
      input: msg.input,
      output: result?.output,
      isError: result?.isError,
      timestamp: Date.now() - (toolUseMessages.length - index) * 1000,
    });
  });

  return tools;
}

// Tool Preview Modal Component
function ToolPreviewModal({
  tool,
  onClose,
}: {
  tool: ToolUsage;
  onClose: () => void;
}) {
  const formatInput = (input: unknown): string => {
    if (!input) return '—';
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  const formatOutput = (output: string | undefined): string => {
    if (!output) return '—';
    // Truncate very long output
    if (output.length > 5000) {
      return output.slice(0, 5000) + '\n\n... (truncated)';
    }
    return output;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="bg-background border-border relative flex max-h-[80vh] w-[600px] max-w-[90vw] flex-col rounded-lg border shadow-xl">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {(() => {
              const IconComponent = getToolIcon(tool.name);
              return <IconComponent className="text-muted-foreground size-4" />;
            })()}
            <span className="font-medium">{tool.name}</span>
            {tool.isError && (
              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-500">
                Error
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="hover:bg-accent rounded-md p-1 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* Input Section */}
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">
              Input
            </h3>
            <pre className="bg-muted/50 max-h-[200px] overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap">
              {formatInput(tool.input)}
            </pre>
          </div>

          {/* Output Section */}
          <div>
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">
              Output
            </h3>
            <pre
              className={cn(
                'max-h-[300px] overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap',
                tool.isError ? 'bg-red-500/10 text-red-400' : 'bg-muted/50',
              )}
            >
              {formatOutput(tool.output)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// Default number of items to show before "show more"
const DEFAULT_VISIBLE_COUNT = 5;

// Max file size for text content preview (10MB)
const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024;

// Check file size via API
async function checkFileSize(
  filePath: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/files/stat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.exists && data.size !== undefined) {
      return data.size;
    }
    return null;
  } catch {
    return null;
  }
}

// Read file content via API with optional abort signal
async function readFileContent(
  filePath: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/files/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (data.success && data.content !== undefined) {
      return data.content;
    }
    return null;
  } catch (err) {
    // Don't log abort errors
    if (err instanceof Error && err.name === 'AbortError') {
      return null;
    }
    return null;
  }
}

// File Tree Item Component for recursive directory display
function FileTreeItem({
  file,
  depth = 0,
  onSelectFile,
  onSelectArtifact,
  activeFileLoadRef,
}: {
  file: WorkingFile;
  depth?: number;
  onSelectFile?: (file: WorkingFile) => void;
  onSelectArtifact: (artifact: Artifact) => void;
  activeFileLoadRef: React.MutableRefObject<AbortController | null>;
}) {
  const [isExpanded, setIsExpanded] = useState(file.isExpanded ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const ext = file.name.split('.').pop()?.toLowerCase();
  const IconComponent = file.isDir ? FolderOpen : getFileIconByExt(ext);

  const handleClick = async () => {
    if (file.isDir) {
      setIsExpanded(!isExpanded);
    } else if (onSelectFile) {
      onSelectFile(file);
    } else {
      const artifactType = getArtifactTypeFromExt(ext);

      // For binary/streaming files, don't read content - just pass the path
      if (SKIP_CONTENT_TYPES.includes(artifactType)) {
        const artifact: Artifact = {
          id: file.path,
          name: file.name,
          type: artifactType,
          path: file.path,
        };
        onSelectArtifact(artifact);
        return;
      }

      // Cancel any previous file loading operation
      if (activeFileLoadRef.current) {
        activeFileLoadRef.current.abort();
      }

      // Create new AbortController for this operation
      const controller = new AbortController();
      activeFileLoadRef.current = controller;

      // For text-based files, check size first then load content
      setIsLoading(true);
      try {
        // Check file size first
        const fileSize = await checkFileSize(file.path, controller.signal);

        // If aborted during size check, exit
        if (controller.signal.aborted) {
          setIsLoading(false);
          return;
        }

        // If file is too large, don't read content
        if (fileSize !== null && fileSize > MAX_TEXT_FILE_SIZE) {
          const artifact: Artifact = {
            id: file.path,
            name: file.name,
            type: artifactType,
            path: file.path,
            fileSize: fileSize,
            fileTooLarge: true,
          };
          onSelectArtifact(artifact);
          setIsLoading(false);
          return;
        }

        // Read content with abort signal
        const content = await readFileContent(file.path, controller.signal);

        // If aborted during content read, exit
        if (controller.signal.aborted) {
          setIsLoading(false);
          return;
        }

        const artifact: Artifact = {
          id: file.path,
          name: file.name,
          type: artifactType,
          path: file.path,
          content: content || undefined,
          fileSize: fileSize || undefined,
        };
        onSelectArtifact(artifact);
      } finally {
        // Only clear loading if this is still the active controller
        if (activeFileLoadRef.current === controller) {
          setIsLoading(false);
          activeFileLoadRef.current = null;
        }
      }
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-left transition-colors',
          'hover:bg-accent/50',
          isLoading && 'opacity-70',
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <span className="text-muted-foreground/50 flex size-4 shrink-0 items-center justify-center">
          {file.isDir ? (
            isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )
          ) : null}
        </span>
        {isLoading ? (
          <AILoadingIndicator size="sm" />
        ) : (
          <IconComponent className="text-muted-foreground/60 size-3.5 shrink-0" />
        )}
        <span className="text-foreground/80 truncate text-sm">{file.name}</span>
      </button>
      {file.isDir && isExpanded && file.children && (
        <div>
          {file.children.map((child) => (
            <FileTreeItem
              key={child.path}
              file={child}
              depth={depth + 1}
              onSelectFile={onSelectFile}
              onSelectArtifact={onSelectArtifact}
              activeFileLoadRef={activeFileLoadRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Empty State Component
function EmptyState({
  icon: Icon,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="bg-muted/30 rounded p-1.5">
        <Icon className="text-muted-foreground/40 size-3.5" />
      </div>
      <p className="text-muted-foreground/60 text-xs">{description}</p>
    </div>
  );
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  children,
  defaultExpanded = true,
  headerAction,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  /** Optional action button rendered on the right side of the header,
   *  next to the chevron. Click events are isolated so they don't toggle
   *  the section. */
  headerAction?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  // defaultExpanded often starts false (content loads async, e.g. workspace
  // file listing) then flips true once content arrives — useState only reads
  // it at mount, so without this the section stays collapsed forever. Track
  // manual toggles so this auto-expand doesn't fight a user who collapsed it.
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (defaultExpanded && !userToggledRef.current) {
      setIsExpanded(true);
    }
  }, [defaultExpanded]);
  const toggleExpanded = useCallback(() => {
    userToggledRef.current = true;
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className="border-border/50 border-b">
      <div className="hover:bg-accent/30 flex w-full items-center justify-between px-4 py-3 transition-colors">
        <button
          onClick={toggleExpanded}
          className="flex flex-1 cursor-pointer items-center text-left"
        >
          <span className="text-foreground text-sm font-medium">{title}</span>
        </button>
        <div className="flex items-center gap-1">
          {headerAction}
          <button
            onClick={toggleExpanded}
            className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5 transition-colors"
            aria-label={isExpanded ? t.task.collapse : t.task.expand}
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        </div>
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Skills directory info
interface SkillsDirInfo {
  name: string;
  path: string;
  exists: boolean;
}

// Get skills directories from API
async function fetchSkillsDirs(): Promise<SkillsDirInfo[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/files/skills-dir`);
    if (response.ok) {
      const data = await response.json();
      return (data.directories || []).filter((d: SkillsDirInfo) => d.exists);
    }
  } catch {
    // ignore
  }
  return [];
}

// Extract used skill names from messages
function extractUsedSkillNames(messages: AgentMessage[]): Set<string> {
  const skillNames = new Set<string>();
  const toolUseMessages = messages.filter(
    (m) => m.type === 'tool_use' && isSkillTool(m.name || ''),
  );

  toolUseMessages.forEach((msg) => {
    const input = msg.input as Record<string, unknown> | undefined;
    const skillName = input?.skill as string;
    if (skillName) {
      skillNames.add(skillName);
    }
  });

  return skillNames;
}

// Extract external folders from messages (folders outside workingDir that were accessed)
function extractExternalFolders(
  messages: AgentMessage[],
  workingDir?: string,
): string[] {
  const foldersSet = new Set<string>();
  // Normalize workingDir for consistent comparison
  const normalizedWorkDir = workingDir?.replace(/\\/g, '/');

  // Helper to add folder if it's external
  const addIfExternal = (rawPath: string) => {
    if (!rawPath) return;
    // Normalize backslashes to forward slashes to avoid duplicates on macOS
    const filePath = rawPath.replace(/\\/g, '/');

    const isAbsolutePath =
      filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath);
    if (!isAbsolutePath) return;

    // Get folder path
    const lastSlash = filePath.lastIndexOf('/');
    const folderPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '/';

    // Skip degenerate paths (root-only, too short to be meaningful)
    if (!folderPath || folderPath === '/') return;

    // Only add if it's not within workingDir
    if (!normalizedWorkDir || !filePath.startsWith(normalizedWorkDir)) {
      foldersSet.add(folderPath);
    }
  };

  // Helper to extract paths from Bash command
  const extractPathsFromCommand = (command: string) => {
    // Only extract from file operation commands
    const fileOpCommands = [
      'rm',
      'mv',
      'cp',
      'mkdir',
      'touch',
      'cat',
      'ls',
      'find',
      'open',
    ];
    const commandLower = command.toLowerCase().trim();

    // Check if command starts with a file operation
    const isFileOp = fileOpCommands.some(
      (op) =>
        commandLower.startsWith(op + ' ') ||
        commandLower.includes(' ' + op + ' '),
    );
    if (!isFileOp) return;

    // Folders to ignore (system/hidden folders)
    const ignoredFolders = [
      'Library',
      '.cache',
      '.npm',
      '.config',
      'node_modules',
      '.git',
      '.Trash',
    ];

    // Match absolute paths (starting with /) or home paths (starting with ~)
    const pathRegex = /(?:^|[\s"'=])((?:~|\/)[^\s"'<>|&;]+)/g;
    let match;
    while ((match = pathRegex.exec(command)) !== null) {
      let path = match[1].trim();
      // Clean up trailing punctuation
      path = path.replace(/[,;:]+$/, '');

      // Skip ignored folders
      const pathParts = path.split('/');
      if (pathParts.some((part) => ignoredFolders.includes(part))) {
        continue;
      }

      if (path.startsWith('~')) {
        // For ~ paths, add as-is (will be displayed with ~)
        const normalizedPath = path.replace(/\\/g, '/');
        const lastSlash = normalizedPath.lastIndexOf('/');
        const folderPath =
          lastSlash > 0
            ? normalizedPath.substring(0, lastSlash)
            : normalizedPath;
        if (folderPath && folderPath !== '~') {
          foldersSet.add(folderPath);
        }
      } else if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path)) {
        addIfExternal(path);
      }
    }
  };

  messages.forEach((msg) => {
    if (msg.type !== 'tool_use') return;

    const input = msg.input as Record<string, unknown> | undefined;
    if (!input) return;

    switch (msg.name) {
      case 'Read':
      case 'Write':
      case 'Edit': {
        const filePath = input.file_path as string | undefined;
        if (filePath) addIfExternal(filePath);
        break;
      }
      case 'Glob': {
        // Glob has 'path' parameter for directory
        const path = input.path as string | undefined;
        if (path) addIfExternal(path);
        break;
      }
      case 'Grep': {
        // Grep has 'path' parameter
        const path = input.path as string | undefined;
        if (path) addIfExternal(path);
        break;
      }
      case 'Bash': {
        // Try to extract paths from bash command
        const command = input.command as string | undefined;
        if (command) extractPathsFromCommand(command);
        break;
      }
    }
  });

  return Array.from(foldersSet);
}

// Get file icon based on artifact type
function getFileIcon(type: Artifact['type']) {
  switch (type) {
    case 'html':
      return FileCode2;
    case 'jsx':
      return FileCode2;
    case 'css':
      return FileCode2;
    case 'json':
      return FileText;
    case 'image':
      return FileImage;
    case 'code':
      return FileCode2;
    case 'markdown':
      return FileType;
    case 'csv':
      return Table;
    case 'document':
      return FileText;
    case 'spreadsheet':
      return FileSpreadsheet;
    case 'presentation':
      return Presentation;
    case 'pdf':
      return FileText;
    case 'video':
      return Video;
    case 'audio':
      return Music;
    case 'font':
      return Type;
    case 'websearch':
      return Globe;
    default:
      return File;
  }
}

// Extract artifacts from messages
function extractArtifacts(messages: AgentMessage[]): Artifact[] {
  const artifacts: Artifact[] = [];
  const seenPaths = new Set<string>();

  messages.forEach((msg) => {
    if (msg.type === 'tool_use' && msg.name === 'Write') {
      const input = msg.input as Record<string, unknown> | undefined;
      const filePath = input?.file_path as string | undefined;
      const content = input?.content as string | undefined;

      if (filePath && !seenPaths.has(filePath)) {
        seenPaths.add(filePath);
        const filename = filePath.split('/').pop() || filePath;
        const ext = filename.split('.').pop()?.toLowerCase();
        const type = getArtifactTypeFromExt(ext);

        artifacts.push({
          id: filePath,
          name: filename,
          type,
          content,
          path: filePath,
        });
      }
    }
  });

  return artifacts;
}

// Read directory via API (uses Node.js fs on backend)
async function readDirViaApi(
  dirPath: string,
): Promise<{ files: WorkingFile[]; error?: string }> {
  const FETCH_TIMEOUT = 5000; // 5 second timeout

  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(`${API_BASE_URL}/files/readdir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dirPath, maxDepth: 3 }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { files: [], error: 'Failed to read directory' };
      }

      const data = await response.json();

      // Check for API error (e.g., directory doesn't exist)
      if (data.error) {
        return { files: [], error: data.error };
      }

      if (!data.files || !Array.isArray(data.files)) {
        return { files: [], error: 'Invalid response format' };
      }

      // Convert API response to WorkingFile format with isExpanded
      function addExpandedFlag(files: WorkingFile[], depth = 0): WorkingFile[] {
        return files.map((file) => ({
          ...file,
          isExpanded: false, // Default all folders to collapsed
          children: file.children
            ? addExpandedFlag(file.children, depth + 1)
            : undefined,
        }));
      }

      return { files: addExpandedFlag(data.files) };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        return { files: [], error: 'Request timeout' };
      }
      throw err;
    }
  } catch (err) {
    if (import.meta.env.DEV)
      console.error(`[RightSidebar] Failed to fetch directory:`, err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return { files: [], error: errorMessage };
  }
}

export function RightSidebar({
  messages,
  artifacts: externalArtifacts,
  selectedArtifact,
  onSelectArtifact,
  workingDir,
  onSelectWorkingFile,
  filesVersion = 0,
  taskId,
  isRunning = false,
}: RightSidebarProps) {
  const { t, tt } = useLanguage();
  const [selectedTool, setSelectedTool] = useState<ToolUsage | null>(null);
  const { summary: traceSummary } = useTraceStream(messages, isRunning);

  // Ref for active file loading AbortController — scoped to this component instance
  const activeFileLoadRef = useRef<AbortController | null>(null);

  // Cleanup active file loading on unmount
  useEffect(() => {
    return () => {
      if (activeFileLoadRef.current) {
        activeFileLoadRef.current.abort();
        activeFileLoadRef.current = null;
      }
    };
  }, []);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [workingFiles, setWorkingFiles] = useState<WorkingFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [workingDirError, setWorkingDirError] = useState<string | null>(null);
  const [skillsDirs, setSkillsDirs] = useState<
    { name: string; files: WorkingFile[] }[]
  >([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(true);
  const [editedExpanded, setEditedExpanded] = useState(true);

  // Cache for loaded working directory to avoid redundant loads
  const workingDirCacheRef = useRef<{
    dir: string;
    files: WorkingFile[];
    version: number;
  } | null>(null);

  // Load files from working directory via API
  // Refresh when workingDir changes, artifacts change, or files are added (e.g., attachments)
  useEffect(() => {
    let cancelled = false;
    let loadingTimeoutId: NodeJS.Timeout | null = null;

    async function loadWorkingFiles() {
      if (!workingDir || !workingDir.startsWith('/')) {
        setWorkingFiles([]);
        setLoadingFiles(false);
        setWorkingDirError(null);
        return;
      }

      // Check cache: skip loading if same dir and version
      const cache = workingDirCacheRef.current;
      if (
        cache &&
        cache.dir === workingDir &&
        cache.version === filesVersion &&
        cache.files.length > 0
      ) {
        // Use cached data, no need to reload
        setWorkingFiles(cache.files);
        setWorkingDirError(null); // Clear any previous errors
        setLoadingFiles(false);
        return;
      }

      setLoadingFiles(true);

      // Failsafe: force loading state to false after 8 seconds
      loadingTimeoutId = setTimeout(() => {
        if (import.meta.env.DEV)
          console.error(
            '[RightSidebar] Loading timeout - forcing loading state to false',
          );
        setLoadingFiles(false);
      }, 8000);

      try {
        const result = await readDirViaApi(workingDir);
        if (cancelled) return;

        // Check for errors
        if (result.error) {
          if (!isNotFoundError(result.error)) {
            if (import.meta.env.DEV)
              console.error(
                '[RightSidebar] Error loading working directory:',
                result.error,
              );
            setWorkingDirError(result.error);
          } else {
            setWorkingDirError(null);
          }
          setWorkingFiles([]);
          // Don't cache error results
          workingDirCacheRef.current = null;
        } else {
          // Update cache
          workingDirCacheRef.current = {
            dir: workingDir,
            files: result.files,
            version: filesVersion,
          };

          setWorkingDirError(null);

          // Use startTransition to mark this as a low-priority update
          startTransition(() => {
            setWorkingFiles(result.files);
          });
        }
      } catch (err) {
        if (cancelled) return;
        if (import.meta.env.DEV)
          console.error('[RightSidebar] Error loading working files:', err);
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error';

        if (!isNotFoundError(errorMessage)) {
          setWorkingDirError(errorMessage);
        } else {
          setWorkingDirError(null);
        }
        setWorkingFiles([]);
      } finally {
        if (!cancelled) {
          if (loadingTimeoutId) {
            clearTimeout(loadingTimeoutId);
          }
          setLoadingFiles(false);
        }
      }
    }

    loadWorkingFiles();

    return () => {
      cancelled = true;
      if (loadingTimeoutId) {
        clearTimeout(loadingTimeoutId);
      }
    };
  }, [workingDir, filesVersion]);

  // Get used skill names from messages (memoized to avoid recalculating on every render)
  const usedSkillNames = useMemo(
    () => extractUsedSkillNames(messages),
    [messages],
  );

  // Load skills folders (only for used skills)
  useEffect(() => {
    async function loadSkillsFiles() {
      // Only load if there are used skills
      if (usedSkillNames.size === 0) {
        setSkillsDirs([]);
        setLoadingSkills(false);
        return;
      }

      setLoadingSkills(true);
      try {
        const dirs = await fetchSkillsDirs();
        const results: { name: string; files: WorkingFile[] }[] = [];

        for (const dir of dirs) {
          const result = await readDirViaApi(dir.path);
          // Skip if there was an error loading this directory
          if (result.error) {
            continue;
          }

          // Filter to only show used skills (match by folder name)
          const filteredFiles = result.files.filter((file) => {
            // Check if folder name matches any used skill
            return file.isDir && usedSkillNames.has(file.name);
          });

          if (filteredFiles.length > 0) {
            results.push({ name: dir.name, files: filteredFiles });
          }
        }

        setSkillsDirs(results);
      } catch {
        setSkillsDirs([]);
      } finally {
        setLoadingSkills(false);
      }
    }

    loadSkillsFiles();
  }, [usedSkillNames]);

  // Extract artifacts from messages (memoized)
  const internalArtifacts = useMemo(
    () => extractArtifacts(messages),
    [messages],
  );
  const artifacts =
    externalArtifacts.length > 0 ? externalArtifacts : internalArtifacts;

  // Split artifacts into outputs (final deliverables) and remaining (intermediate)
  const { outputArtifacts, remainingArtifacts } = useMemo(() => {
    const outputs: typeof artifacts = [];
    const remaining: typeof artifacts = [];
    for (const a of artifacts) {
      if (a.isOutput) {
        outputs.push(a);
      } else {
        remaining.push(a);
      }
    }
    return { outputArtifacts: outputs, remainingArtifacts: remaining };
  }, [artifacts]);

  // Artifacts with show more/less (max 10)
  const visibleArtifacts = showAllArtifacts
    ? remainingArtifacts
    : remainingArtifacts.slice(0, 10);
  const hasMoreArtifacts = remainingArtifacts.length > 10;

  // MCP tools only (memoized)
  const mcpTools = useMemo(
    () => extractMcpTools(messages, t.task),
    [messages, t.task],
  );
  const visibleTools = showAllTools
    ? mcpTools
    : mcpTools.slice(0, DEFAULT_VISIBLE_COUNT);
  const hasMoreTools = mcpTools.length > DEFAULT_VISIBLE_COUNT;

  // Extract and deduplicate external folders (memoized — heavy computation)
  const externalFolders = useMemo(() => {
    const raw = extractExternalFolders(messages, workingDir);
    return raw.filter((folder) => {
      // Remove if another folder is a parent of this one
      if (
        raw.some((other) => other !== folder && folder.startsWith(other + '/'))
      ) {
        return false;
      }
      // Filter out session folders — they're the agent's working directory, not external refs
      if (/\/sessions\/session-/.test(folder)) return false;
      return true;
    });
  }, [messages, workingDir]);

  // Get display path (shorten to folder name only)
  const getFolderName = (path: string) => path.split('/').pop() || path;

  // Open folder in system
  const handleOpenFolder = useCallback(async (folderPath: string) => {
    try {
      // Handle ~ paths - let backend resolve it
      const response = await fetch(`${API_BASE_URL}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath, expandHome: true }),
      });
      const data = await response.json();
      if (!data.success) {
        if (import.meta.env.DEV)
          console.error('[RightSidebar] Failed to open folder:', data.error);
      }
    } catch (err) {
      if (import.meta.env.DEV)
        console.error('[RightSidebar] Error opening folder:', err);
    }
  }, []);

  // Auto-expand workspace only if there's content to show
  const hasWorkspaceContent =
    workingFiles.length > 0 || externalFolders.length > 0;

  // Output folder shortcut — derived from the first output artifact that
  // landed on disk. Output artifacts typically share <workingDir>/output/
  // as their parent, so a single button covers the common case.
  const outputFolderDir = useMemo(() => {
    const firstWithPath = outputArtifacts.find((a) => a.path);
    if (!firstWithPath?.path) return null;
    const idx = firstWithPath.path.lastIndexOf('/');
    return idx > 0 ? firstWithPath.path.slice(0, idx) : null;
  }, [outputArtifacts]);

  return (
    <div className="bg-background flex h-full flex-col overflow-x-hidden overflow-y-auto">
      {/* 1. Workspace Section */}
      <CollapsibleSection
        title={t.task.workspace || 'Workspace'}
        defaultExpanded={hasWorkspaceContent}
      >
        {/* Output folder subsection */}
        <div className="mt-1 mb-3">
          <div className="mb-1 flex items-center gap-1">
            <button
              onClick={() => setOutputExpanded(!outputExpanded)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              {outputExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              <span className="text-xs font-medium">
                {t.task.outputFolder || 'Output'}
              </span>
            </button>
            {workingDir && (
              <button
                onClick={() => handleOpenFolder(workingDir)}
                className="text-muted-foreground hover:text-foreground ml-auto p-0.5 transition-colors"
                title={t.task.openInFinder}
              >
                <ExternalLink className="size-3" />
              </button>
            )}
          </div>
          {outputExpanded && (
            <>
              {!workingDir ? (
                <p className="text-muted-foreground py-1 text-sm">
                  {t.task.waitingForTask}
                </p>
              ) : loadingFiles ? (
                <div className="text-muted-foreground flex items-center gap-2 py-1">
                  <AILoadingIndicator size="sm" />
                  <span className="text-sm">{t.common.loading}</span>
                </div>
              ) : workingDirError ? (
                <div className="flex items-start gap-2 rounded-md bg-red-500/10 px-2 py-2">
                  <svg
                    viewBox="0 0 16 16"
                    className="mt-0.5 size-3.5 shrink-0 text-red-500"
                    fill="currentColor"
                  >
                    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 4.5a1 1 0 112 0v3a1 1 0 11-2 0v-3zm1 7a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {workingDirError.includes('EACCES') ||
                      workingDirError.includes('permission')
                        ? t.task.permissionDenied
                        : t.task.failedToLoadWorkspace}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {workingDirError}
                    </p>
                  </div>
                </div>
              ) : workingFiles.length === 0 ? (
                <EmptyState icon={Folder} description={t.task.outputsDesc} />
              ) : (
                <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
                  {workingFiles.map((file) => (
                    <FileTreeItem
                      key={file.path}
                      file={file}
                      onSelectFile={onSelectWorkingFile}
                      onSelectArtifact={onSelectArtifact}
                      activeFileLoadRef={activeFileLoadRef}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Edited folders subsection */}
        {externalFolders.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1">
              <button
                onClick={() => setEditedExpanded(!editedExpanded)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {editedExpanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span className="text-xs font-medium">
                  {t.task.editedFolders || 'Edited'}
                </span>
              </button>
            </div>
            {editedExpanded && (
              <div className="space-y-0.5">
                {externalFolders.map((folder) => (
                  <button
                    key={folder}
                    onClick={() => handleOpenFolder(folder)}
                    className="hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-md py-1 text-left transition-colors"
                  >
                    <span className="size-4 shrink-0" />
                    <FolderOpen className="text-muted-foreground/60 size-3.5 shrink-0" />
                    <span className="text-foreground/80 truncate text-sm">
                      {getFolderName(folder)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* 2. Output Section — final deliverables */}
      <CollapsibleSection
        title={t.task.output}
        defaultExpanded={true}
        headerAction={
          outputFolderDir ? (
            <button
              onClick={() => handleOpenFolder(outputFolderDir)}
              className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
              title={t.task.openInFinder}
              aria-label={t.task.openInFinder}
            >
              <FolderOpen className="size-3.5" />
            </button>
          ) : null
        }
      >
        {outputArtifacts.length === 0 ? (
          <EmptyState icon={FileOutput} description={t.task.noOutput} />
        ) : (
          <div className="space-y-1">
            {outputArtifacts.map((artifact) => {
              const IconComponent = getFileIcon(artifact.type);
              const isSelected = selectedArtifact?.id === artifact.id;

              return (
                <button
                  key={artifact.id}
                  onClick={() => onSelectArtifact(artifact)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors',
                    isSelected ? 'bg-accent/60' : 'hover:bg-accent/30',
                  )}
                >
                  <IconComponent
                    className={cn(
                      'size-3.5 shrink-0',
                      isSelected
                        ? 'text-foreground/70'
                        : 'text-muted-foreground/60',
                    )}
                  />
                  <span
                    className={cn(
                      'truncate text-sm',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                  >
                    {artifact.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* 3. Artifacts Section — intermediate/working files */}
      <CollapsibleSection title={t.task.artifacts} defaultExpanded={false}>
        {remainingArtifacts.length === 0 ? (
          <EmptyState icon={Package} description={t.task.noArtifacts} />
        ) : (
          <>
            <div
              className={cn(
                'space-y-1',
                showAllArtifacts && 'max-h-[300px] overflow-y-auto',
              )}
            >
              {visibleArtifacts.map((artifact) => {
                const IconComponent = getFileIcon(artifact.type);
                const isSelected = selectedArtifact?.id === artifact.id;

                return (
                  <button
                    key={artifact.id}
                    onClick={() => onSelectArtifact(artifact)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors',
                      isSelected ? 'bg-accent/60' : 'hover:bg-accent/30',
                    )}
                  >
                    <IconComponent
                      className={cn(
                        'size-3.5 shrink-0',
                        isSelected
                          ? 'text-foreground/70'
                          : 'text-muted-foreground/60',
                      )}
                    />
                    <span
                      className={cn(
                        'truncate text-sm',
                        isSelected ? 'text-foreground' : 'text-foreground/80',
                      )}
                    >
                      {artifact.name}
                    </span>
                  </button>
                );
              })}
            </div>
            {hasMoreArtifacts && (
              <button
                onClick={() => setShowAllArtifacts(!showAllArtifacts)}
                className="text-muted-foreground hover:text-foreground w-full py-2 text-center text-xs transition-colors"
              >
                {showAllArtifacts
                  ? t.common.showLess
                  : tt('common.showMoreCount', {
                      count: remainingArtifacts.length - 10,
                    })}
              </button>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* 4. Tools Section - MCP tools */}
      <CollapsibleSection title={t.task.tools} defaultExpanded={false}>
        {mcpTools.length === 0 ? (
          <EmptyState icon={Wrench} description={t.task.noTools} />
        ) : (
          <>
            <div
              className={cn(
                'space-y-1',
                showAllTools && 'max-h-[300px] overflow-y-auto',
              )}
            >
              {visibleTools.map((tool) => {
                const IconComponent = getToolIcon(tool.name);
                return (
                  <button
                    key={tool.id}
                    onClick={() => setSelectedTool(tool)}
                    className={cn(
                      'group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 text-left transition-colors',
                      'hover:bg-accent/50',
                      tool.isError && 'text-red-400',
                    )}
                  >
                    <IconComponent
                      className={cn(
                        'size-3.5 shrink-0',
                        tool.isError
                          ? 'text-red-400'
                          : 'text-muted-foreground/60',
                      )}
                    />
                    <span className="text-foreground/80 truncate text-sm">
                      {tool.displayName}
                    </span>
                    {tool.isError && (
                      <span className="shrink-0 rounded bg-red-500/10 px-1 py-0.5 text-[10px] text-red-500">
                        {t.task.error}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {hasMoreTools && (
              <button
                onClick={() => setShowAllTools(!showAllTools)}
                className="text-muted-foreground hover:text-foreground w-full py-2 text-center text-xs transition-colors"
              >
                {showAllTools
                  ? t.common.showLess
                  : tt('common.showMoreCount', {
                      count: mcpTools.length - DEFAULT_VISIBLE_COUNT,
                    })}
              </button>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* 5. Changes Section — file diffs from agent-written snapshots */}
      {taskId && (
        <CollapsibleSection
          title={t.task.changes ?? 'Changes'}
          defaultExpanded={false}
        >
          <FileDiffViewer taskId={taskId} version={filesVersion} />
        </CollapsibleSection>
      )}

      {/* 6. Trace Section — compact metrics summary */}
      <CollapsibleSection
        title={t.task.trace ?? 'Trace'}
        defaultExpanded={false}
      >
        <TraceMetricsSummary summary={traceSummary} isLive={isRunning} />
      </CollapsibleSection>

      {/* 7. Documents Section */}
      {taskId && (
        <CollapsibleSection
          title={
            ((t.task as Record<string, unknown>).documents as string) ??
            'Documents'
          }
          defaultExpanded={false}
        >
          <DocumentPanel taskId={taskId} />
        </CollapsibleSection>
      )}

      {/* 7. Skills Section */}
      <CollapsibleSection title={t.task.skills} defaultExpanded={false}>
        {loadingSkills ? (
          <div className="text-muted-foreground flex items-center gap-2 py-2">
            <AILoadingIndicator size="sm" />
            <span className="text-sm">{t.common.loading}</span>
          </div>
        ) : usedSkillNames.size === 0 ? (
          <EmptyState icon={Sparkles} description={t.task.noSkills} />
        ) : skillsDirs.length === 0 ? (
          // Show skill names only if skill files couldn't be loaded
          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {Array.from(usedSkillNames).map((skillName) => (
              <div
                key={skillName}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <Sparkles className="text-muted-foreground/60 size-3.5 shrink-0" />
                <span className="text-foreground/80 truncate text-sm">
                  {skillName}
                </span>
              </div>
            ))}
          </div>
        ) : (
          // Show skill files/content
          <div className="max-h-[300px] space-y-0.5 overflow-y-auto">
            {skillsDirs.map((dir) => (
              <div key={dir.name}>
                {dir.files.map((file) => (
                  <FileTreeItem
                    key={file.path}
                    file={{ ...file, isExpanded: false }}
                    onSelectFile={onSelectWorkingFile}
                    onSelectArtifact={onSelectArtifact}
                    activeFileLoadRef={activeFileLoadRef}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Tool Preview Modal */}
      {selectedTool && (
        <ToolPreviewModal
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </div>
  );
}

// Export types for external use
export type { WorkingFile };
