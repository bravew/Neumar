import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  getArtifactTypeFromExt,
  type Artifact,
  type ArtifactType,
} from '@/components/artifacts';
import { API_BASE_URL } from '@/config';
import { useSettingsValue } from '@/shared/db/settings';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useTraceStream } from '@/shared/hooks/useTraceStream';
import { computeSessionFolder } from '@/shared/lib/session';
import { useLanguage } from '@/shared/providers/language-provider';

import { ActivityPanel } from './ActivityPanel';
import { DetailsPanel } from './DetailsPanel';
import { FilesPanel } from './FilesPanel';
import type { WorkingFile } from './FileTreeItem';
import type { ToolUsage } from './sidebar-bits';

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
  const { t } = useLanguage();
  const advancedMode = useSettingsValue().advancedMode;
  const [panel, setPanel] = useState<'activity' | 'files'>('activity');
  const [detailsOverride, setDetailsOverride] = useState<boolean | null>(null);
  const detailsOpen = detailsOverride ?? advancedMode;
  const [focusPath, setFocusPath] = useState<string | undefined>();
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

  // `workingDir` (task.work_dir) is frequently empty — it's only backfilled
  // once the agent stream happens to emit a `session` event with a cwd,
  // which doesn't always happen. Fall back to the same default session-
  // folder convention `computeSessionFolder` uses elsewhere in the app
  // instead of leaving this panel stuck on "waiting" for a task that
  // already finished and has real output on disk.
  const [effectiveWorkingDir, setEffectiveWorkingDir] = useState<
    string | undefined
  >(workingDir);
  useEffect(() => {
    if (workingDir) {
      setEffectiveWorkingDir(workingDir);
      return;
    }
    if (!taskId) {
      setEffectiveWorkingDir(undefined);
      return;
    }
    let cancelled = false;
    void computeSessionFolder(taskId, workingDir).then((resolved) => {
      if (!cancelled) setEffectiveWorkingDir(resolved ?? undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [workingDir, taskId]);

  // Load files from working directory via API
  // Refresh when effectiveWorkingDir changes, artifacts change, or files are added (e.g., attachments)
  useEffect(() => {
    let cancelled = false;
    let loadingTimeoutId: NodeJS.Timeout | null = null;

    async function loadWorkingFiles() {
      // Accept `~`-prefixed paths too — expandPath() only expands in Tauri;
      // in the browser it returns the path unchanged, but the backend
      // /files/readdir endpoint expands `~` itself, so this is still valid.
      if (
        !effectiveWorkingDir ||
        !(
          effectiveWorkingDir.startsWith('/') ||
          effectiveWorkingDir.startsWith('~')
        )
      ) {
        setWorkingFiles([]);
        setLoadingFiles(false);
        setWorkingDirError(null);
        return;
      }

      // Check cache: skip loading if same dir and version
      const cache = workingDirCacheRef.current;
      if (
        cache &&
        cache.dir === effectiveWorkingDir &&
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
        const result = await readDirViaApi(effectiveWorkingDir);
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
            dir: effectiveWorkingDir,
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
  }, [effectiveWorkingDir, filesVersion]);

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

  const mcpTools = useMemo(
    () => extractMcpTools(messages, t.task),
    [messages, t.task],
  );

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

  const openDiff = useCallback((path: string) => {
    setFocusPath(path);
    setDetailsOverride(true);
  }, []);

  return (
    <div className="bg-background flex h-full flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label={t.task.panelActivity}
        className="border-border/50 flex shrink-0 gap-1 border-b px-3 py-2"
      >
        <button
          type="button"
          role="tab"
          aria-selected={panel === 'activity'}
          className={
            panel === 'activity'
              ? 'bg-accent text-foreground rounded-md px-2.5 py-1 text-sm font-medium'
              : 'text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-sm'
          }
          onClick={() => setPanel('activity')}
        >
          {t.task.panelActivity}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === 'files'}
          className={
            panel === 'files'
              ? 'bg-accent text-foreground rounded-md px-2.5 py-1 text-sm font-medium'
              : 'text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-sm'
          }
          onClick={() => setPanel('files')}
        >
          {t.task.panelFiles}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {panel === 'activity' ? (
          <ActivityPanel
            messages={messages}
            sessionRoot={effectiveWorkingDir}
            onOpenDiff={openDiff}
          />
        ) : (
          <FilesPanel
            outputArtifacts={outputArtifacts}
            remainingArtifacts={remainingArtifacts}
            selectedArtifact={selectedArtifact}
            onSelectArtifact={onSelectArtifact}
            outputFolderDir={outputFolderDir}
            handleOpenFolder={handleOpenFolder}
            hasWorkspaceContent={hasWorkspaceContent}
            outputExpanded={outputExpanded}
            setOutputExpanded={setOutputExpanded}
            editedExpanded={editedExpanded}
            setEditedExpanded={setEditedExpanded}
            effectiveWorkingDir={effectiveWorkingDir}
            loadingFiles={loadingFiles}
            workingDirError={workingDirError}
            workingFiles={workingFiles}
            externalFolders={externalFolders}
            onSelectWorkingFile={onSelectWorkingFile}
            activeFileLoadRef={activeFileLoadRef}
            getFolderName={getFolderName}
          />
        )}
      </div>
      <div className="border-border/50 shrink-0 border-t">
        <button
          type="button"
          aria-expanded={detailsOpen}
          className="hover:bg-accent/30 flex w-full items-center justify-between px-4 py-2.5 text-left"
          onClick={() => setDetailsOverride(!detailsOpen)}
        >
          <span className="text-foreground text-sm font-medium">
            {t.task.panelDetails}
          </span>
          {detailsOpen ? (
            <ChevronDown className="text-muted-foreground size-4" />
          ) : (
            <ChevronRight className="text-muted-foreground size-4" />
          )}
        </button>
        {detailsOpen && (
          <div className="max-h-[50%] overflow-y-auto">
            <DetailsPanel
              mcpTools={mcpTools}
              taskId={taskId}
              filesVersion={filesVersion}
              focusPath={focusPath}
              traceSummary={traceSummary}
              isRunning={isRunning}
              loadingSkills={loadingSkills}
              usedSkillNames={usedSkillNames}
              skillsDirs={skillsDirs}
              effectiveWorkingDir={effectiveWorkingDir}
              onSelectWorkingFile={onSelectWorkingFile}
              onSelectArtifact={onSelectArtifact}
              activeFileLoadRef={activeFileLoadRef}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Export types for external use
export type { WorkingFile };
