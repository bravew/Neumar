import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { ArrowDown, PanelLeft, Wand2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Panel,
  Group as PanelGroup,
  useDefaultLayout,
} from 'react-resizable-panels';

import {
  getArtifactTypeFromExt,
  hasValidSearchResults,
  type Artifact,
} from '@/components/artifacts';
import { shouldTreatArtifactAsOutput } from '@/components/artifacts/output-classification';
import { LeftSidebar, SidebarProvider, useSidebar } from '@/components/layout';
import { AvatarSvg } from '@/components/profiles/avatar-options';
import { ChatInput, DEFAULT_MODEL_ID } from '@/components/shared/ChatInput';
import { ExtractSkillDialog } from '@/components/task/ExtractSkillDialog';
import { LocalOutputArtifactPreviews } from '@/components/task/LocalOutputArtifactPreviews';
import { MemoryAuditPill } from '@/components/task/MemoryAuditPill';
import { MessageList } from '@/components/task/MessageList';
import { QuestionInput } from '@/components/task/QuestionInput';
import { RightSidebar } from '@/components/task/RightSidebar';
import { RunningIndicator } from '@/components/task/RunningIndicator';
import { UserMessage } from '@/components/task/UserMessage';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { ResizeHandle } from '@/components/ui/resize-handle';
import type { MediaVersion } from '@/components/workspace';
import { WorkspaceRouter } from '@/components/workspace';
import {
  DURATION,
  PulsingDot,
  scrollButton as scrollButtonVariant,
} from '@/config/animation';
import type { LibraryFile, Task } from '@/shared/db';
import {
  deleteTask,
  getAllTasks,
  getFilesByTaskId,
  getTask,
  updateTask,
} from '@/shared/db';
import {
  getSettings,
  saveSettings,
  useSettingsValue,
} from '@/shared/db/settings';
import type { TaskPlan } from '@/shared/hooks/agent-types';
import {
  buildModelOverride,
  DETECTABLE_FILE_EXT_WITH_HTML,
  useAgent,
  type MessageAttachment,
  type ModelOverride,
} from '@/shared/hooks/useAgent';
import { useMediaVersions } from '@/shared/hooks/useMediaVersions';
import { useNeumaAGUIEvents } from '@/shared/hooks/useNeumaAGUIEvents';
import { useResizeAutoFollow } from '@/shared/hooks/useResizeAutoFollow';
import { useVitePreview } from '@/shared/hooks/useVitePreview';
import { resolveArtifactPath } from '@/shared/lib/paths';
import { deleteSessionFolder } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { AgentExternalRuntimeProvider } from '@/shared/providers/AgentExternalRuntimeProvider';
import { useLanguage } from '@/shared/providers/language-provider';

/** Distance from bottom to detect user has scrolled up (px). */
const SCROLL_UP_DETECTION_THRESHOLD = 100;

/** Distance from bottom to re-enable auto-scroll (px). */
const AUTO_SCROLL_ENABLE_THRESHOLD = 50;

/** Scroll distance to show the scroll-to-bottom button (px). */
const SCROLL_BUTTON_VISIBILITY_THRESHOLD = 200;

/** Delay before fetching updated task title after completion (ms). */
const TITLE_REFRESH_DELAY = 5000;

/** Max display length for task title in the header. */
const TITLE_DISPLAY_TRUNCATION = 40;

// Module-level constant — avoids recreating on every render
const MEDIA_TYPES = new Set(['image', 'video', 'audio']);

const OUTPUT_MARKER_RE = /Output\s*:\s*`?([^`\s\n]+)`?/gi;

// Skill tool output file-detection patterns (module-level to avoid per-render allocation)
const SKILL_FILE_PATTERNS = [
  new RegExp(
    `(?:Output|saved|created|generated|wrote)\\s+(?:saved\\s+)?(?:to\\s*)?:?\\s*\`?([^\\s\`\\n]+\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))\`?`,
    'gi',
  ),
  new RegExp(`\`([^\`]+\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))\``, 'gi'),
  new RegExp(
    `(\\/[^\\s"'\`\\n]+\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))`,
    'gi',
  ),
];

// Text message media file-detection patterns
const MEDIA_EXT =
  'mp4|webm|mov|avi|mkv|mp3|wav|flac|ogg|aac|m4a|png|jpg|jpeg|gif|webp|svg|bmp';
const TEXT_FILE_PATTERNS = [
  new RegExp(`\`([^\`]+\\.(?:${MEDIA_EXT}))\``, 'gi'),
  new RegExp(`(\\/[^\\s"'\`\\n]+\\.(?:${MEDIA_EXT}))`, 'gi'),
];

// Helper to convert file type from LibraryFile to Artifact type
function convertFileType(fileType: string): Artifact['type'] {
  switch (fileType) {
    case 'presentation':
      return 'presentation';
    case 'spreadsheet':
      return 'spreadsheet';
    case 'document':
      return 'document';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'code':
      return 'code';
    case 'website':
      return 'html';
    case 'websearch':
      return 'websearch';
    default:
      return 'text';
  }
}

interface LocationState {
  prompt?: string;
  sessionId?: string;
  taskIndex?: number;
  attachments?: MessageAttachment[];
  workDir?: string;
  modelOverride?: ModelOverride;
  mentionedMcpServers?: string[];
  pinnedSkills?: string[];
  projectId?: string;
  assigneeProfileId?: string;
  profileDisplay?: {
    name: string;
    role: string | null;
    avatarIcon: string | null;
    avatarColor: string | null;
    defaultModel: string | null;
    systemPrompt: string | null;
    mcpServerCount: number;
    skillCount: number;
  };
}

// Context for tool selection - allows child components to select tools
interface ToolSelectionContextType {
  selectedToolIndex: number | null;
  setSelectedToolIndex: (index: number | null) => void;
  showComputer: () => void;
}

const ToolSelectionContext = createContext<ToolSelectionContextType | null>(
  null,
);

export function useToolSelection() {
  const context = useContext(ToolSelectionContext);
  if (!context) {
    throw new Error(
      'useToolSelection must be used within ToolSelectionContext',
    );
  }
  return context;
}

/**
 * Dispatches AG-UI plan/interrupt events from the assistant-ui thread to useAgent state.
 * Must be a child of AgentExternalRuntimeProvider to access the runtime context.
 */
function NeumaAGUIEventDispatcher({
  setPlan,
}: {
  setPlan: (p: TaskPlan) => void;
}) {
  useNeumaAGUIEvents({ onPlan: setPlan });
  return null;
}

export function TaskDetailPage() {
  return (
    <SidebarProvider>
      <TaskDetailContent />
    </SidebarProvider>
  );
}

/** Small profile avatar for the task header bar. */
function ProfileAvatar({
  avatarIcon,
  avatarColor,
}: {
  avatarIcon: string | null;
  avatarColor: string | null;
}) {
  return (
    <AvatarSvg
      avatarId={avatarIcon}
      color={avatarColor || '#6366f1'}
      className="size-5 shrink-0 overflow-hidden rounded"
    />
  );
}

function TaskDetailContent() {
  const { t } = useLanguage();
  const { taskId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState | null;
  const initialPrompt = state?.prompt || '';
  const initialSessionId = state?.sessionId;
  const initialTaskIndex = state?.taskIndex || 1;
  const initialAttachments = state?.attachments;
  const initialWorkDir = state?.workDir || null;
  const initialModelOverride = state?.modelOverride;
  const initialMentionedMcpServers = state?.mentionedMcpServers;
  const initialPinnedSkills = state?.pinnedSkills;
  const profileDisplay = state?.profileDisplay;

  // Track the selected model for the reply input.
  // Priority: route state (new task) → per-task localStorage → DEFAULT.
  // Never fall back to the global lastSelectedChatModel to prevent cross-task contamination.
  const currentSettings = useSettingsValue();
  const [selectedModel, setSelectedModel] = useState(() => {
    if (initialModelOverride?.model) return initialModelOverride.model;
    if (taskId) {
      const persisted = localStorage.getItem(`task_model_${taskId}`);
      if (persisted) return persisted;
    }
    return DEFAULT_MODEL_ID;
  });

  const {
    messages,
    isRunning,
    agentSessionId,
    runAgent,
    continueConversation,
    stopAgent,
    loadTask,
    loadMessages,
    phase,
    isPlanRestored,
    approvePlan,
    rejectPlan,
    pendingQuestion,
    respondToQuestion,
    sessionFolder,
    filesVersion,
    backgroundTasks,
    setPlan,
  } = useAgent();

  // Persist the initial model override for new tasks so re-visits restore it correctly
  useEffect(() => {
    if (initialModelOverride?.model && taskId) {
      localStorage.setItem(`task_model_${taskId}`, initialModelOverride.model);
    }
  }, [initialModelOverride?.model, taskId]);

  // When taskId changes (sidebar navigation, same component instance), reset model
  // to the per-task persisted value. Falls back to DEFAULT — never global lastSelectedChatModel.
  useEffect(() => {
    if (!taskId || taskId === prevTaskIdRef.current) return;
    modelInferredRef.current = false;
    const persisted = localStorage.getItem(`task_model_${taskId}`);
    setSelectedModel(persisted ?? DEFAULT_MODEL_ID);
  }, [taskId]);

  // Infer model from message history for tasks that have no persisted model yet
  // (e.g. tasks created before per-task persistence was introduced).
  useEffect(() => {
    if (!taskId || modelInferredRef.current) return;
    if (localStorage.getItem(`task_model_${taskId}`)) return;
    const inferredModel = [...messages].reverse().find((m) => m.model)?.model;
    if (inferredModel) {
      modelInferredRef.current = true;
      setSelectedModel(inferredModel);
      localStorage.setItem(`task_model_${taskId}`, inferredModel);
    }
  }, [taskId, messages]);

  const { toggleLeft, setLeftOpen } = useSidebar();
  const [hasStarted, setHasStarted] = useState(false);
  const loadGenerationRef = useRef(0); // Generation counter to handle concurrent task loads
  const [task, setTask] = useState<Task | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const prevTaskIdRef = useRef<string | undefined>(undefined);
  const hasAutoSelectedArtifactRef = useRef(false); // Track if we've auto-selected an artifact
  const modelInferredRef = useRef(false); // Track if we've inferred model from message history

  // Panel visibility state - default to collapsed, auto-expand when content is available
  const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);
  const [showExtractSkillDialog, setShowExtractSkillDialog] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);

  // Scroll to bottom button state
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Track if user has manually scrolled up (to disable auto-scroll)
  const userScrolledUpRef = useRef(false);
  // Track last scroll position to detect scroll direction
  const lastScrollTopRef = useRef(0);

  // Auto-collapse left sidebar only when preview panel opens
  useEffect(() => {
    if (isPreviewVisible) {
      setLeftOpen(false);
    }
  }, [isPreviewVisible, setLeftOpen]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Artifact state
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );

  // Media version tracking
  const { versions: mediaVersions, selectVersion: handleSelectMediaVersion } =
    useMediaVersions(taskId || '', messages, artifacts);

  // Working directory state - use sessionFolder (show full session directory tree)
  // Only depend on sessionFolder and artifacts, not messages (to avoid frequent recalculations)
  const workingDir = useMemo(() => {
    // Use sessionFolder from useAgent if available
    if (sessionFolder) {
      return sessionFolder;
    }

    // Try to extract session directory from artifact paths
    for (const artifact of artifacts) {
      if (artifact.path && artifact.path.includes('/sessions/')) {
        const sessionMatch = artifact.path.match(/^(.+\/sessions\/[^/]+)/);
        if (sessionMatch) {
          return sessionMatch[1];
        }
      }
    }

    return '';
  }, [sessionFolder, artifacts]);

  // Track if sidebar has been auto-expanded (to avoid re-opening after manual close)
  const hasAutoExpandedRef = useRef(false);

  // Reset right sidebar state when switching tasks
  useEffect(() => {
    if (taskId !== prevTaskIdRef.current) {
      // Reset auto-expand flag for new task
      hasAutoExpandedRef.current = false;
      // Close right sidebar when switching to a new task
      setIsRightSidebarVisible(false);
      // Set loading to true immediately to prevent auto-expand effect
      // from using stale data from the previous task
      setIsLoading(true);
    }
  }, [taskId]);

  // Auto-expand right sidebar when there is actual output content (only once)
  // Content includes: artifacts or files created via Write/Edit tools
  useEffect(() => {
    // Skip if still loading - wait for task data to be ready
    if (isLoading) return;

    // Skip if task data not loaded yet or task doesn't match current taskId
    // This prevents using stale data from the previous task during task switching
    if (!task || task.id !== taskId) return;

    // Skip if already auto-expanded
    if (hasAutoExpandedRef.current) return;

    // Check if there's actual output content to display (artifacts or created files)
    const hasArtifacts = artifacts.length > 0;
    const hasWorkspace = !!workingDir;
    const hasFileCreation = messages.some(
      (m) => m.type === 'tool_use' && ['Write', 'Edit'].includes(m.name || ''),
    );

    const hasContent = hasArtifacts || (hasWorkspace && hasFileCreation);

    // Auto-expand when content becomes available (only once)
    if (hasContent) {
      setIsRightSidebarVisible(true);
      hasAutoExpandedRef.current = true;
    }
    // If no content, ensure sidebar stays collapsed (don't auto-expand)
    // The sidebar starts collapsed by default and should stay that way for empty sessions
  }, [artifacts.length, messages, workingDir, isLoading, task, taskId]);

  // Live preview state
  const {
    previewUrl: livePreviewUrl,
    status: livePreviewStatus,
    error: livePreviewError,
    startPreview,
    stopPreview,
  } = useVitePreview(taskId || null);

  // Handle starting live preview
  const handleStartLivePreview = useCallback(() => {
    if (workingDir) {
      startPreview(workingDir);
    }
  }, [workingDir, startPreview]);

  // Handle stopping live preview — stopPreview is already stable from useVitePreview
  const handleStopLivePreview = stopPreview;

  // Tool search — constant (no search UI yet)
  // Tool search query — reserved for future search/filter UI

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Handle title click to start editing
  const handleTitleClick = useCallback(() => {
    const currentTitle = task?.title || task?.prompt || initialPrompt;
    setEditedTitle(currentTitle);
    setIsEditingTitle(true);
  }, [task?.title, task?.prompt, initialPrompt]);

  // Handle title save — writes to the `title` field, NEVER modifies `prompt`
  const handleTitleSave = useCallback(async () => {
    if (!taskId || !editedTitle.trim()) {
      setIsEditingTitle(false);
      return;
    }

    const trimmedTitle = editedTitle.trim();
    const currentTitle = task?.title || task?.prompt || initialPrompt;
    if (trimmedTitle !== currentTitle) {
      try {
        const updatedTask = await updateTask(taskId, { title: trimmedTitle });
        if (updatedTask) {
          setTask(updatedTask);
          // Refresh all tasks to update sidebar
          const tasks = await getAllTasks();
          setAllTasks(tasks);
        }
      } catch (error) {
        if (import.meta.env.DEV)
          console.error('Failed to update task title:', error);
      }
    }
    setIsEditingTitle(false);
  }, [taskId, editedTitle, task?.title, task?.prompt, initialPrompt]);

  // Handle title input key down
  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleTitleSave();
      } else if (e.key === 'Escape') {
        setIsEditingTitle(false);
      }
    },
    [handleTitleSave],
  );

  // Focus title input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Handle artifact selection - opens preview
  const handleSelectArtifact = useCallback((artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setIsPreviewVisible(true);
  }, []);

  // Handle closing preview
  const handleClosePreview = useCallback(() => {
    setIsPreviewVisible(false);
    setSelectedArtifact(null);
  }, []);

  // Handle version selection from workspace
  const handleWorkspaceSelectVersion = useCallback(
    (version: MediaVersion) => {
      const versionArtifact = artifacts.find(
        (a) => a.id === version.artifactId,
      );
      if (versionArtifact) {
        handleSelectArtifact(versionArtifact);
      }
      handleSelectMediaVersion(version);
    },
    [artifacts, handleSelectArtifact, handleSelectMediaVersion],
  );

  // Handle message from workspace inline reply
  const handleWorkspaceMessage = useCallback(
    (message: string) => {
      if (message.trim() && !isRunning) {
        continueConversation(message.trim());
      }
    },
    [isRunning, continueConversation],
  );

  // Auto-expand workspace when a new media artifact is generated
  const seenArtifactIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    // On initial load (existing task history), just record all artifact IDs without expanding
    if (isInitialLoadRef.current && !isLoading) {
      for (const a of artifacts) {
        seenArtifactIdsRef.current.add(a.id);
      }
      isInitialLoadRef.current = false;
      return;
    }

    // Skip during loading
    if (isLoading) return;

    // Find the latest media artifact we haven't seen yet
    let latestMedia: Artifact | null = null;
    for (const a of artifacts) {
      if (!seenArtifactIdsRef.current.has(a.id) && MEDIA_TYPES.has(a.type)) {
        latestMedia = a;
      }
      seenArtifactIdsRef.current.add(a.id);
    }

    // Auto-select and expand for the new media artifact
    if (latestMedia) {
      setSelectedArtifact(latestMedia);
      setIsPreviewVisible(true);
    }
  }, [artifacts, isLoading]);

  // Reset auto-expand refs when task changes
  useEffect(() => {
    seenArtifactIdsRef.current = new Set();
    isInitialLoadRef.current = true;
  }, [taskId]);

  // Memoize workspace context to avoid unnecessary re-renders
  const workspaceContext = useMemo(
    () => ({
      taskId: taskId || '',
      messages,
      isRunning,
    }),
    [taskId, messages, isRunning],
  );

  // Selected tool operation index for syncing with virtual computer
  const [selectedToolIndex, setSelectedToolIndex] = useState<number | null>(
    null,
  );

  // Calculate total tool count for auto-selection
  const toolCount = useMemo(() => {
    return messages.filter((m) => m.type === 'tool_use').length;
  }, [messages]);

  // Auto-select the latest tool when running
  useEffect(() => {
    if (isRunning && toolCount > 0) {
      setSelectedToolIndex(toolCount - 1);
    }
  }, [toolCount, isRunning]);

  // Tool selection context value
  const toolSelectionValue = useMemo(
    () => ({
      selectedToolIndex,
      setSelectedToolIndex,
      showComputer: () => {}, // No-op since we removed the separate computer panel
    }),
    [selectedToolIndex],
  );

  // convertFileType is defined at module level (below) to avoid recreation on every render

  // Extract artifacts from messages AND load from database
  useEffect(() => {
    const loadArtifacts = async () => {
      const extractedArtifacts: Artifact[] = [];
      const seenPaths = new Set<string>();

      // 1. Extract from Write tool messages (in-memory content)
      messages.forEach((msg) => {
        if (msg.type === 'tool_use' && msg.name === 'Write') {
          const input = msg.input as Record<string, unknown> | undefined;
          const filePath = input?.file_path as string | undefined;
          const content = input?.content as string | undefined;

          if (filePath) {
            const resolved = resolveArtifactPath(filePath, workingDir);
            if (!seenPaths.has(resolved)) {
              seenPaths.add(resolved);
              const filename = resolved.split('/').pop() || resolved;
              const ext = filename.split('.').pop()?.toLowerCase();

              extractedArtifacts.push({
                id: resolved,
                name: filename,
                type: getArtifactTypeFromExt(ext),
                content,
                path: resolved,
              });
            }
          }
        }

        // Extract WebSearch results as artifacts
        if (msg.type === 'tool_use' && msg.name === 'WebSearch') {
          const input = msg.input as Record<string, unknown> | undefined;
          const query = input?.query as string | undefined;
          const toolUseId = msg.id;
          if (query) {
            // Find the corresponding tool_result by toolUseId or by position
            let output = '';
            if (toolUseId) {
              const resultMsg = messages.find(
                (m) => m.type === 'tool_result' && m.toolUseId === toolUseId,
              );
              output = resultMsg?.output || '';
            }
            // Fallback: find the next tool_result after this tool_use
            if (!output) {
              const msgIndex = messages.indexOf(msg);
              for (let i = msgIndex + 1; i < messages.length; i++) {
                if (messages[i].type === 'tool_result') {
                  output = messages[i].output || '';
                  break;
                }
                if (messages[i].type === 'tool_use') break; // Stop at next tool_use
              }
            }

            const artifactId = `websearch-${query}`;
            // Only add websearch artifact if it has valid search results
            if (
              !seenPaths.has(artifactId) &&
              output &&
              hasValidSearchResults(output)
            ) {
              seenPaths.add(artifactId);
              extractedArtifacts.push({
                id: artifactId,
                name: `Search: ${query.slice(0, 50)}${query.length > 50 ? '...' : ''}`,
                type: 'websearch',
                content: output,
              });
            }
          }
        }
      });

      // 1.5. Extract files from Skill tool output (all detectable file types, from tool_result)
      // Only extract from Skill tool results since they produce verified artifacts
      messages.forEach((msg) => {
        if (msg.type === 'tool_result' && msg.toolUseId) {
          // Find the corresponding tool_use message to check if it's a Skill tool
          const toolUseMsg = messages.find(
            (m) => m.type === 'tool_use' && m.id === msg.toolUseId,
          );

          if (toolUseMsg?.name === 'Skill' && msg.output) {
            for (const pattern of SKILL_FILE_PATTERNS) {
              // Reset lastIndex for reusable regex
              pattern.lastIndex = 0;
              const matches = msg.output.matchAll(pattern);

              for (const match of matches) {
                let filePath = match[1] || match[0];
                if (!filePath) continue;

                filePath = resolveArtifactPath(filePath, workingDir);

                if (!seenPaths.has(filePath)) {
                  seenPaths.add(filePath);
                  const filename = filePath.split('/').pop() || filePath;
                  const ext = filename.split('.').pop()?.toLowerCase();

                  extractedArtifacts.push({
                    id: filePath,
                    name: filename,
                    type: getArtifactTypeFromExt(ext),
                    path: filePath,
                  });
                }
              }
            }
          }
        }
      });

      // 1.6. Fallback: scan text messages for media file paths
      // Only scan messages that contain an explicit output marker to avoid
      // false positives from AI explanations that casually mention file paths.
      messages.forEach((msg) => {
        OUTPUT_MARKER_RE.lastIndex = 0;
        if (
          msg.type === 'text' &&
          msg.content &&
          OUTPUT_MARKER_RE.test(msg.content)
        ) {
          for (const pattern of TEXT_FILE_PATTERNS) {
            pattern.lastIndex = 0;
            const matches = msg.content.matchAll(pattern);
            for (const match of matches) {
              let filePath = match[1] || match[0];
              if (!filePath) continue;

              filePath = resolveArtifactPath(filePath, workingDir);

              if (!seenPaths.has(filePath)) {
                seenPaths.add(filePath);
                const filename = filePath.split('/').pop() || filePath;
                const ext = filename.split('.').pop()?.toLowerCase();

                extractedArtifacts.push({
                  id: filePath,
                  name: filename,
                  type: getArtifactTypeFromExt(ext),
                  path: filePath,
                });
              }
            }
          }
        }
      });

      // 2. Load files from database (includes files from Skill tool, etc.)
      if (taskId) {
        try {
          const dbFiles = await getFilesByTaskId(taskId);
          dbFiles.forEach((file: LibraryFile) => {
            // Skip websearch - we extract these from messages with full output content
            // Check path pattern (search:// is used for WebSearch results)
            if (file.path?.startsWith('search://')) return;

            let filePath = file.path
              ? resolveArtifactPath(file.path, workingDir)
              : undefined;

            // Skip if we already have this file from Write tool
            if (filePath && !seenPaths.has(filePath)) {
              seenPaths.add(filePath);
              extractedArtifacts.push({
                id: filePath || `file-${file.id}`,
                name: file.name,
                type: convertFileType(file.type),
                content: file.preview || undefined,
                path: filePath,
              });
            }
          });
        } catch (error) {
          if (import.meta.env.DEV)
            console.error('Failed to load files from database:', error);
        }
      }

      // Final dedup: by resolved path AND by filename+type.
      // The filename+type pass catches duplicates where workingDir is empty
      // (e.g. relative "video.mp4" vs absolute "/workspace/video.mp4").
      // When two entries share the same basename+type, keep the one with
      // the longer (more specific / absolute) path.
      {
        const pathSeen = new Set<string>();
        const filenameSeen = new Map<string, number>(); // basename:type → index
        const deduped: Artifact[] = [];
        for (const a of extractedArtifacts) {
          const key = a.path || a.id;
          if (pathSeen.has(key)) continue;
          pathSeen.add(key);

          const basename = a.path?.split('/').pop() || a.name;
          const fnKey = `${basename}:${a.type}`;
          const existingIdx = filenameSeen.get(fnKey);
          if (existingIdx !== undefined) {
            // Prefer the entry with a longer (absolute) path
            const existing = deduped[existingIdx];
            if (
              a.path &&
              existing.path &&
              a.path.length > existing.path.length
            ) {
              deduped[existingIdx] = a;
            }
            continue;
          }
          filenameSeen.set(fnKey, deduped.length);
          deduped.push(a);
        }
        extractedArtifacts.length = 0;
        extractedArtifacts.push(...deduped);
      }

      // Classify artifacts as output using LLM markers, file type, and directory
      const outputPaths = new Set<string>();
      for (const msg of messages) {
        if (msg.type === 'text' && msg.content) {
          OUTPUT_MARKER_RE.lastIndex = 0;
          let match;
          while ((match = OUTPUT_MARKER_RE.exec(msg.content)) !== null) {
            const p = match[1]
              ? resolveArtifactPath(match[1], workingDir)
              : undefined;
            if (p) outputPaths.add(p);
          }
        }
      }

      for (const artifact of extractedArtifacts) {
        artifact.isOutput = shouldTreatArtifactAsOutput(artifact, outputPaths);
      }

      // Only update artifacts if they actually changed (prevent render loop)
      setArtifacts((prevArtifacts) => {
        // Check if artifacts actually changed by comparing IDs
        if (prevArtifacts.length !== extractedArtifacts.length) {
          return extractedArtifacts;
        }

        const toKey = (a: Artifact) => `${a.id}:${a.isOutput ? '1' : '0'}`;
        const prevIds = prevArtifacts.map(toKey).sort().join(',');
        const newIds = extractedArtifacts.map(toKey).sort().join(',');

        if (prevIds !== newIds) {
          return extractedArtifacts;
        }

        // Artifacts haven't changed, return previous reference to prevent re-render
        return prevArtifacts;
      });

      // Auto-select first artifact if none selected (only once per task)
      if (
        extractedArtifacts.length > 0 &&
        !selectedArtifact &&
        !hasAutoSelectedArtifactRef.current
      ) {
        setSelectedArtifact(extractedArtifacts[0]);
        hasAutoSelectedArtifactRef.current = true;
      }
    };

    loadArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, taskId, workingDir]); // selectedArtifact intentionally omitted to avoid re-running when it changes

  const scrollToLatestMessage = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      messagesEndRef.current?.scrollIntoView({ behavior });
    },
    [],
  );

  // Auto scroll to bottom only when task is running AND user hasn't scrolled up
  useEffect(() => {
    if (isRunning && !userScrolledUpRef.current) {
      scrollToLatestMessage('smooth');
    }
  }, [messages, isRunning, scrollToLatestMessage]);

  // Reset userScrolledUp when task stops running
  useEffect(() => {
    if (!isRunning) {
      userScrolledUpRef.current = false;
    }
  }, [isRunning]);

  // Check scroll position to show/hide scroll button and detect manual scroll
  const checkScrollPosition = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // Detect if user scrolled up (scroll position decreased)
    if (
      isRunning &&
      scrollTop < lastScrollTopRef.current &&
      distanceFromBottom > SCROLL_UP_DETECTION_THRESHOLD
    ) {
      userScrolledUpRef.current = true;
    }

    // If user scrolled to near bottom, re-enable auto-scroll
    if (distanceFromBottom < AUTO_SCROLL_ENABLE_THRESHOLD) {
      userScrolledUpRef.current = false;
    }

    lastScrollTopRef.current = scrollTop;

    // Show button if far enough from bottom
    setShowScrollButton(
      distanceFromBottom > SCROLL_BUTTON_VISIBILITY_THRESHOLD,
    );
  }, [isRunning]);

  // Add scroll listener to messages container
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', checkScrollPosition);
    // Initial check
    checkScrollPosition();

    return () => {
      container.removeEventListener('scroll', checkScrollPosition);
    };
  }, [checkScrollPosition]);

  const shouldFollowMessageResize = useCallback(
    () => isRunning && !userScrolledUpRef.current,
    [isRunning],
  );
  const followMessageResize = useCallback(() => {
    scrollToLatestMessage('auto');
  }, [scrollToLatestMessage]);

  useResizeAutoFollow({
    targetRef: messagesContentRef,
    enabled: isRunning,
    shouldFollow: shouldFollowMessageResize,
    follow: followMessageResize,
    onResize: checkScrollPosition,
  });

  // Re-check scroll position when messages load or loading state changes
  useEffect(() => {
    if (!isLoading && messages.length > 0) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        checkScrollPosition();
      });
    }
  }, [isLoading, messages.length, checkScrollPosition]);

  // Scroll to bottom handler - also re-enables auto-scroll
  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    scrollToLatestMessage('smooth');
  }, [scrollToLatestMessage]);

  // Load all tasks for sidebar
  useEffect(() => {
    async function loadAllTasks() {
      try {
        const dbTasks = await getAllTasks();
        setAllTasks((prev) => {
          // Preserve current task if it exists in prev but not in database yet
          // This handles the race condition where optimistic update added the task
          // but database hasn't persisted it yet
          const currentTaskInPrev = prev.find((t) => t.id === taskId);
          const taskExistsInDb = dbTasks.some((t) => t.id === taskId);

          if (currentTaskInPrev && !taskExistsInDb) {
            // Keep the optimistic task at the beginning
            return [currentTaskInPrev, ...dbTasks];
          }
          return dbTasks;
        });
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to load tasks:', error);
      }
    }
    loadAllTasks();
  }, [task, taskId]);

  // Listen for auto-generated title updates and refresh sidebar + current task.
  // Title is stored in task.title — task.prompt (the user's original message) is NEVER changed.
  useEffect(() => {
    function handleTitleUpdate(e: Event) {
      const { taskId: updatedTaskId, title } = (
        e as CustomEvent<{ taskId: string; title: string }>
      ).detail;

      // Update sidebar task list with the new title
      setAllTasks((prev) =>
        prev.map((t) => (t.id === updatedTaskId ? { ...t, title } : t)),
      );

      // Update the current task object if it matches
      if (updatedTaskId === taskId) {
        setTask((prev) => (prev ? { ...prev, title } : prev));
      }
    }

    window.addEventListener('task-title-updated', handleTitleUpdate);
    return () =>
      window.removeEventListener('task-title-updated', handleTitleUpdate);
  }, [taskId]);

  // Handle task deletion from sidebar
  const handleDeleteTask = useCallback(
    async (id: string, deleteFolder?: boolean) => {
      try {
        // Get task info before deleting (to get session_id)
        const taskToDelete = await getTask(id);

        // Delete task from database
        await deleteTask(id);
        setAllTasks((prev) => prev.filter((t) => t.id !== id));

        // If deleting current task, navigate to home
        if (id === taskId) {
          navigate('/');
        }

        // Delete session folder if requested (best-effort, errors are logged internally)
        // Pass per-task work_dir so the correct folder is targeted
        if (deleteFolder && taskToDelete) {
          await deleteSessionFolder(
            taskToDelete.id,
            taskToDelete.work_dir,
            taskToDelete.session_id,
          );
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to delete task:', error);
      }
    },
    [taskId, navigate],
  );

  // Handle favorite toggle from sidebar — wrapped in useCallback so child
  // components that are memoized don't re-render when unrelated state changes.
  const handleToggleFavorite = useCallback(
    async (id: string, favorite: boolean) => {
      try {
        await updateTask(id, { favorite });
        setAllTasks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, favorite } : t)),
        );
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to update task:', error);
      }
    },
    [],
  );

  // Reset UI state when taskId changes (but don't touch agent/task state - let loadTask handle that)
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      if (prevTaskIdRef.current !== undefined) {
        // Only reset UI state here - loadTask will handle task switching
        setTask(null);
        setHasStarted(false);
        setIsLoading(false); // Reset loading state

        // Reset preview and artifact state
        setIsPreviewVisible(false);
        setSelectedArtifact(null);
        setArtifacts([]);
        setSelectedToolIndex(null);

        // Reset right sidebar state
        setIsRightSidebarVisible(false);
        hasAutoExpandedRef.current = false;
        hasAutoSelectedArtifactRef.current = false; // Reset artifact auto-selection

        // Stop live preview if running
        stopPreview();
      }
      prevTaskIdRef.current = taskId;
    }
  }, [taskId, stopPreview]);

  // Load existing task or start new one
  useEffect(() => {
    const INITIALIZATION_TIMEOUT = 10000; // 10 seconds timeout
    let timeoutId: NodeJS.Timeout | null = null;

    // Increment generation to invalidate any in-flight initialization
    const generation = ++loadGenerationRef.current;
    const isStale = () => loadGenerationRef.current !== generation;

    async function initialize() {
      if (!taskId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      // Set a timeout to prevent infinite loading
      timeoutId = setTimeout(() => {
        if (isStale()) return;
        if (import.meta.env.DEV)
          console.error(
            '[TaskDetail] Initialization timeout - forcing completion',
          );
        setIsLoading(false);
      }, INITIALIZATION_TIMEOUT);

      try {
        const existingTask = await loadTask(taskId);
        if (isStale()) return;

        if (existingTask) {
          setTask(existingTask);
          // Ensure this task is in the sidebar immediately
          setAllTasks((prev) => {
            const exists = prev.some((t) => t.id === existingTask.id);
            return exists ? prev : [existingTask, ...prev];
          });
          await loadMessages(taskId);
          if (isStale()) return;
          setHasStarted(true);
        } else if (initialPrompt && !hasStarted) {
          setHasStarted(true);

          // Immediately add the new task to sidebar (optimistic update)
          const newTaskPreview: Task = {
            id: taskId,
            session_id: initialSessionId || '',
            task_index: initialTaskIndex,
            prompt: initialPrompt,
            status: 'running',
            favorite: false,
            cost: 0,
            duration: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          setAllTasks((prev) => [newTaskPreview, ...prev]);

          // Pass session info if available
          const sessionInfo = initialSessionId
            ? { sessionId: initialSessionId, taskIndex: initialTaskIndex }
            : undefined;
          await runAgent(
            initialPrompt,
            taskId,
            sessionInfo,
            initialAttachments,
            initialWorkDir || undefined,
            initialModelOverride,
            initialMentionedMcpServers,
            initialPinnedSkills,
          );
          if (isStale()) return;
          const newTask = await loadTask(taskId);
          if (isStale()) return;
          setTask(newTask);

          // Assign to project if created from project context
          if (state?.projectId && taskId) {
            updateTask(taskId, { project_id: state.projectId }).catch(() => {});
          }

          // Auto-title generation runs async in the background.
          // Re-fetch the task after a short delay to pick up the
          // generated title if the custom event was missed.
          setTimeout(async () => {
            if (isStale()) return;
            try {
              const refreshed = await getTask(taskId);
              if (isStale()) return;
              if (refreshed?.title) {
                setTask(refreshed);
                setAllTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId ? { ...t, title: refreshed.title } : t,
                  ),
                );
              }
            } catch {
              // Ignore — non-critical
            }
          }, TITLE_REFRESH_DELAY);
        }
      } catch (error) {
        if (isStale()) return;
        if (import.meta.env.DEV)
          console.error('[TaskDetail] Failed to initialize task:', error);
        // On error, still try to load the task from the database
        try {
          const task = await getTask(taskId);
          if (isStale()) return;
          if (task) {
            setTask(task);
          }
        } catch (fallbackError) {
          if (import.meta.env.DEV)
            console.error(
              '[TaskDetail] Failed to load task from database:',
              fallbackError,
            );
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        // Only update loading state if this generation is still current
        if (!isStale()) {
          setIsLoading(false);
        }
      }
    }

    initialize();

    // Cleanup function to clear timeout if component unmounts
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]); // Only re-initialize when taskId changes, not on other prop changes

  // Re-fetch task data when the window regains focus or tab becomes visible.
  // Ensures the UI reflects changes made by another app instance (browser ↔ desktop).
  // Uses both visibilitychange (browser tabs) and focus (desktop app window switching)
  // with debounce to prevent double-triggering.
  useEffect(() => {
    const DEBOUNCE_MS = 2000;
    let lastRefreshTime = 0;

    function refreshData() {
      const now = Date.now();
      if (now - lastRefreshTime < DEBOUNCE_MS) return;
      lastRefreshTime = now;

      if (!taskId || isRunning) return;

      // Refresh current task metadata (status, etc.)
      getTask(taskId)
        .then((t) => {
          if (t) setTask(t);
        })
        .catch(() => {});
      // Refresh current task messages and plan phase
      loadMessages(taskId).catch(() => {});
      // Refresh sidebar task list
      getAllTasks()
        .then((tasks) => setAllTasks(tasks))
        .catch(() => {});
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshData();
      }
    }

    function handleFocus() {
      refreshData();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [taskId, isRunning, loadMessages]);

  // Handle reply submission from ChatInput
  const handleReply = useCallback(
    async (
      text: string,
      messageAttachments?: MessageAttachment[],
      mentionedMcpServers?: string[],
      pinnedSkills?: string[],
    ) => {
      if (
        (text.trim() ||
          (messageAttachments && messageAttachments.length > 0)) &&
        taskId
      ) {
        await continueConversation(
          text.trim(),
          messageAttachments,
          buildModelOverride(selectedModel),
          mentionedMcpServers,
          pinnedSkills,
        );
      }
    },
    [taskId, continueConversation, selectedModel],
  );

  // Handle retry — re-send the last user message
  const handleRetry = useCallback(() => {
    if (isRunning) return;
    // Find the last user message in the conversation
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'user' && messages[i].content) {
        continueConversation(
          messages[i].content!,
          messages[i].attachments,
          buildModelOverride(selectedModel),
          undefined,
          undefined,
          { retry: true },
        );
        return;
      }
    }
  }, [isRunning, messages, continueConversation, selectedModel]);

  const resumableAgentSessionId = agentSessionId ?? task?.agent_session_id;

  const handleResumeRun = useCallback(() => {
    if (isRunning || !resumableAgentSessionId) return;
    continueConversation(
      t.task.continueRunPrompt,
      undefined,
      buildModelOverride(selectedModel),
      undefined,
      undefined,
      { resumeSessionId: resumableAgentSessionId },
    );
  }, [
    isRunning,
    resumableAgentSessionId,
    continueConversation,
    selectedModel,
    t.task.continueRunPrompt,
  ]);

  // Display title for the header (auto-generated or user-edited title, falls back to prompt)
  const displayTitle = task?.title || task?.prompt || initialPrompt;
  // Display message for the chat — always the user's ORIGINAL message, never modified
  const displayMessage = task?.prompt || initialPrompt;

  // Get attachments for the initial user message:
  // 1. From navigation state (first navigation from home page)
  // 2. Or from the first user message in messages (when reloading/re-entering)
  const displayAttachments = useMemo(() => {
    if (initialAttachments && initialAttachments.length > 0) {
      return initialAttachments;
    }
    const firstUserMessage = messages.find((m) => m.type === 'user');
    return firstUserMessage?.attachments;
  }, [initialAttachments, messages]);

  // Check if we should skip showing the first user message separately
  // (to avoid duplication when messages array already includes it).
  // Check ALL messages, not just messages[0], because a 'thinking' event
  // from reasoning-capable models (e.g. Codex) can land at index 0 and
  // push the actual user message to a later position.
  const firstMessageIsUserWithSameContent = useMemo(() => {
    return messages.some(
      (m) => m.type === 'user' && m.content === displayMessage,
    );
  }, [messages, displayMessage]);

  // Build the list of currently visible panel IDs for layout persistence.
  // This ensures saved layouts are restored correctly even when panels toggle.
  const visiblePanelIds = useMemo(() => {
    const ids = ['chat'];
    if (isPreviewVisible) ids.push('preview');
    if (isRightSidebarVisible) ids.push('right-sidebar');
    return ids;
  }, [isPreviewVisible, isRightSidebarVisible]);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'task-detail-layout',
    panelIds: visiblePanelIds,
    storage: localStorage,
  });

  return (
    <AgentExternalRuntimeProvider
      messages={messages}
      isRunning={isRunning}
      onNew={(prompt) => continueConversation(prompt)}
      onCancel={stopAgent}
    >
      <ToolSelectionContext.Provider value={toolSelectionValue}>
        <div
          className="bg-sidebar flex h-screen overflow-hidden"
          data-testid="task-detail-page"
        >
          {/* Left Sidebar */}
          <LeftSidebar
            tasks={allTasks}
            currentTaskId={taskId}
            onDeleteTask={handleDeleteTask}
            onToggleFavorite={handleToggleFavorite}
            runningTaskIds={[
              ...new Set([
                ...backgroundTasks
                  .filter((t) => t.isRunning)
                  .map((t) => t.taskId),
                // Include current task if it's running
                ...(isRunning && taskId ? [taskId] : []),
                // Include tasks with DB status 'running' (e.g. running in another tab)
                ...allTasks
                  .filter((t) => t.status === 'running')
                  .map((t) => t.id),
              ]),
            ]}
          />

          {/* Main Content Area with Resizable Panels */}
          <div
            ref={containerRef}
            className="bg-background my-2 mr-2 min-w-0 flex-1 overflow-hidden rounded-2xl shadow-sm"
          >
            <PanelGroup
              orientation="horizontal"
              defaultLayout={defaultLayout}
              onLayoutChanged={onLayoutChanged}
              className="h-full"
            >
              {/* Left Panel - Agent Chat */}
              <Panel
                id="chat"
                defaultSize="40%"
                minSize="280px"
                className={cn(
                  'bg-background flex min-w-0 flex-col overflow-hidden',
                  !isPreviewVisible && !isRightSidebarVisible && 'rounded-2xl',
                  !isPreviewVisible && isRightSidebarVisible && 'rounded-l-2xl',
                  isPreviewVisible && 'rounded-l-2xl',
                )}
              >
                {/* Header - Full width */}
                <header className="border-border/50 bg-background z-10 flex shrink-0 items-center gap-2 border-none px-4 py-3">
                  <button
                    onClick={toggleLeft}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors duration-200 md:hidden"
                    aria-label="Toggle sidebar"
                  >
                    <PanelLeft className="size-5" />
                  </button>

                  <div className="min-w-0 flex-1">
                    {isEditingTitle ? (
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        onBlur={handleTitleSave}
                        onKeyDown={handleTitleKeyDown}
                        aria-label="Edit task title"
                        className="text-foreground border-primary/50 focus:border-primary focus:ring-primary/30 max-w-full rounded-md border bg-transparent px-2 py-1 text-sm font-normal outline-none focus:ring-1"
                        style={{
                          width: `${Math.min(
                            Math.max(editedTitle.length + 2, 20),
                            50,
                          )}ch`,
                        }}
                      />
                    ) : (
                      <h1
                        onClick={handleTitleClick}
                        className="text-foreground hover:bg-accent/50 inline-block max-w-full cursor-pointer truncate rounded-md px-2 py-1 text-sm font-normal transition-colors"
                        title="Click to edit title"
                        aria-label="Click to edit task title"
                      >
                        {displayTitle.slice(0, TITLE_DISPLAY_TRUNCATION) ||
                          `Task ${taskId}`}
                        {displayTitle.length > TITLE_DISPLAY_TRUNCATION &&
                          '...'}
                      </h1>
                    )}
                  </div>

                  {/* Running status + profile indicator */}
                  <AnimatePresence>
                    {isRunning && (
                      <motion.span
                        className="text-primary flex items-center gap-2 text-sm"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: DURATION.normal }}
                      >
                        <PulsingDot color="bg-primary" size="size-2" />
                      </motion.span>
                    )}
                  </AnimatePresence>

                  {/* Agent profile badge with hover detail flyover */}
                  {profileDisplay && (
                    <HoverCard openDelay={200}>
                      <HoverCardTrigger asChild>
                        <div className="bg-accent/60 flex cursor-default items-center gap-1.5 rounded-md px-2 py-0.5">
                          <ProfileAvatar
                            avatarIcon={profileDisplay.avatarIcon}
                            avatarColor={profileDisplay.avatarColor}
                          />
                          <span className="text-muted-foreground text-xs">
                            {profileDisplay.name}
                          </span>
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent
                        side="bottom"
                        align="end"
                        className="w-72"
                      >
                        <div className="flex gap-3">
                          <AvatarSvg
                            avatarId={profileDisplay.avatarIcon}
                            color={profileDisplay.avatarColor || '#6366f1'}
                            className="size-10 shrink-0 overflow-hidden rounded-lg"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground text-sm font-medium">
                              {profileDisplay.name}
                            </p>
                            {profileDisplay.role && (
                              <p className="text-muted-foreground text-xs">
                                {profileDisplay.role}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 space-y-1.5">
                          {profileDisplay.defaultModel && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground text-xs">
                                {t.profiles.model}
                              </span>
                              <span className="text-foreground text-xs font-medium">
                                {profileDisplay.defaultModel}
                              </span>
                            </div>
                          )}
                          {profileDisplay.mcpServerCount > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground text-xs">
                                {t.profiles.mcpServers}
                              </span>
                              <span className="text-foreground text-xs font-medium">
                                {profileDisplay.mcpServerCount}
                              </span>
                            </div>
                          )}
                          {profileDisplay.skillCount > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground text-xs">
                                {t.profiles.skills}
                              </span>
                              <span className="text-foreground text-xs font-medium">
                                {profileDisplay.skillCount}
                              </span>
                            </div>
                          )}
                          {profileDisplay.systemPrompt && (
                            <div className="mt-2">
                              <span className="text-muted-foreground text-xs">
                                {t.profiles.systemPrompt}
                              </span>
                              <p className="text-foreground mt-0.5 line-clamp-3 text-xs leading-relaxed">
                                {profileDisplay.systemPrompt}
                              </p>
                            </div>
                          )}
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  )}

                  {/* Extract as Skill button — only for completed tasks */}
                  {!isRunning && task?.status === 'completed' && (
                    <button
                      onClick={() => setShowExtractSkillDialog(true)}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors"
                      title={t.task.extractAsSkill}
                      aria-label={t.task.extractAsSkill}
                    >
                      <Wand2 className="size-4" />
                    </button>
                  )}

                  {/* Memory audit pill — shows count of injected memories for this session */}
                  <MemoryAuditPill sessionId={taskId} />

                  {/* Toggle right sidebar button */}
                  <button
                    onClick={() =>
                      setIsRightSidebarVisible(!isRightSidebarVisible)
                    }
                    className={cn(
                      'text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center justify-center rounded-lg p-2 transition-colors',
                      isRightSidebarVisible && 'bg-accent/50',
                    )}
                    title={
                      isRightSidebarVisible ? 'Hide sidebar' : 'Show sidebar'
                    }
                    aria-label={
                      isRightSidebarVisible
                        ? 'Hide right sidebar'
                        : 'Show right sidebar'
                    }
                  >
                    <PanelLeft className="size-4 rotate-180" />
                  </button>
                </header>

                {/* Messages Area - Always centered with max-width */}
                <div
                  ref={messagesContainerRef}
                  className="relative flex flex-1 justify-center overflow-x-hidden overflow-y-auto"
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={taskId}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 0.18,
                        ease: [0.0, 0.0, 0.2, 1.0],
                      }}
                      className="w-full max-w-[1600px] px-6 pt-4 pb-24"
                    >
                      <div
                        ref={messagesContentRef}
                        className="max-w-full min-w-0 space-y-4"
                      >
                        {displayMessage &&
                          !firstMessageIsUserWithSameContent && (
                            <UserMessage
                              content={displayMessage}
                              attachments={displayAttachments}
                            />
                          )}

                        <MessageList
                          messages={messages}
                          isRunning={isRunning}
                          searchQuery={undefined}
                          phase={phase}
                          autoExecutePlan={
                            (currentSettings.planMode ?? 'on') === 'auto' &&
                            !isPlanRestored
                          }
                          onApprovePlan={approvePlan}
                          onRejectPlan={rejectPlan}
                          onRetry={handleRetry}
                          onResume={
                            resumableAgentSessionId
                              ? handleResumeRun
                              : undefined
                          }
                        />
                        <LocalOutputArtifactPreviews artifacts={artifacts} />

                        {isRunning && (
                          <RunningIndicator messages={messages} phase={phase} />
                        )}

                        {/* Question Input UI - shown when agent asks questions */}
                        {pendingQuestion && (
                          <QuestionInput
                            pendingQuestion={pendingQuestion}
                            onSubmit={respondToQuestion}
                          />
                        )}

                        <div ref={messagesEndRef} />
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Reply Input - Always centered with max-width */}
                <div className="border-border/50 bg-background relative flex shrink-0 justify-center border-none">
                  {/* Scroll to bottom button — animated enter/exit */}
                  <AnimatePresence>
                    {showScrollButton && (
                      <motion.button
                        variants={scrollButtonVariant}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        onClick={scrollToBottom}
                        className="bg-background hover:bg-accent border-border absolute -top-12 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border p-2 shadow-lg transition-colors"
                        title={t.common.scrollToBottom || 'Scroll to bottom'}
                        aria-label="Scroll to bottom"
                      >
                        <ArrowDown className="size-4" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                  <div className="w-full max-w-[1000px] px-4 py-2">
                    <ChatInput
                      variant="reply"
                      placeholder={
                        isRunning ? t.home.replyWhileRunning : t.home.reply
                      }
                      isRunning={isRunning}
                      onSubmit={handleReply}
                      onStop={stopAgent}
                      workDir={task?.work_dir || initialWorkDir}
                      selectedModel={selectedModel}
                      onModelChange={(modelId: string) => {
                        setSelectedModel(modelId);
                        // Persist per-task so navigating away and back restores this task's model
                        if (taskId) {
                          localStorage.setItem(`task_model_${taskId}`, modelId);
                        }
                        // Also update global last-selected so Home page pre-fills with it
                        saveSettings({
                          ...getSettings(),
                          lastSelectedChatModel: modelId,
                        });
                      }}
                      initialMcpServers={initialMentionedMcpServers}
                      initialSkills={initialPinnedSkills}
                    />
                  </div>
                </div>
              </Panel>

              {/* Resize handle + Preview Panel (conditional) */}
              {isPreviewVisible && (
                <>
                  <ResizeHandle id="chat-preview-handle" />
                  <Panel
                    id="preview"
                    defaultSize="40%"
                    minSize="200px"
                    className="bg-muted/10 flex min-w-0 flex-col overflow-hidden"
                  >
                    <WorkspaceRouter
                      artifact={selectedArtifact}
                      allArtifacts={artifacts}
                      versions={mediaVersions}
                      context={workspaceContext}
                      onClose={handleClosePreview}
                      onSelectVersion={handleWorkspaceSelectVersion}
                      onSendMessage={
                        taskId ? handleWorkspaceMessage : undefined
                      }
                      livePreviewUrl={livePreviewUrl}
                      livePreviewStatus={livePreviewStatus}
                      livePreviewError={livePreviewError}
                      onStartLivePreview={
                        workingDir ? handleStartLivePreview : undefined
                      }
                      onStopLivePreview={handleStopLivePreview}
                    />
                  </Panel>
                </>
              )}

              {/* Resize handle + Right Sidebar (conditional) */}
              {isRightSidebarVisible && (
                <>
                  <ResizeHandle id="sidebar-handle" />
                  <Panel
                    id="right-sidebar"
                    defaultSize="280px"
                    minSize="200px"
                    maxSize="400px"
                    className="bg-background flex min-w-0 flex-col overflow-hidden rounded-r-2xl"
                  >
                    <RightSidebar
                      messages={messages}
                      artifacts={artifacts}
                      selectedArtifact={selectedArtifact}
                      onSelectArtifact={handleSelectArtifact}
                      workingDir={workingDir}
                      filesVersion={filesVersion}
                      taskId={taskId}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </div>
        </div>
        <ExtractSkillDialog
          open={showExtractSkillDialog}
          onOpenChange={setShowExtractSkillDialog}
          taskId={taskId!}
          defaultName={task?.title || task?.prompt?.slice(0, 50) || ''}
        />
      </ToolSelectionContext.Provider>
      <NeumaAGUIEventDispatcher setPlan={setPlan} />
    </AgentExternalRuntimeProvider>
  );
}
