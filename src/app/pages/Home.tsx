import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import { BookTemplate, ChevronDown, User, X as XIcon } from 'lucide-react';
import { motion } from 'motion/react';

import { BackgroundTasksSection } from '@/components/home/BackgroundTasksSection';
import { BudgetBanner } from '@/components/home/BudgetBanner';
import { HomeGreeting } from '@/components/home/HomeGreeting';
import { QuickActions } from '@/components/home/QuickActions';
import { StarterChips } from '@/components/home/StarterChips';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { ActivePluginChip } from '@/components/plugins/ActivePluginChip';
import { AvatarSvg } from '@/components/profiles/avatar-options';
import { ChatInput, DEFAULT_MODEL_ID } from '@/components/shared/ChatInput';
import { TemplateGallery } from '@/components/shared/TemplateGallery';
import { ParallelTaskDashboard } from '@/components/task/ParallelTaskDashboard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DURATION, EASE, STAGGER } from '@/config/animation';
import type { AssistantTemplate } from '@/config/assistant-templates';
import type { Task } from '@/shared/db';
import {
  createSession,
  deleteTask,
  getAllTasks,
  getTask,
  updateTask,
} from '@/shared/db';
import {
  getSettingItem,
  getSettings,
  saveSettings,
  useSettingsValue,
} from '@/shared/db/settings';
import { useActivePlugin } from '@/shared/hooks/useActivePlugin';
import {
  buildModelOverride,
  type MessageAttachment,
} from '@/shared/hooks/useAgent';
import { useAgentProfiles } from '@/shared/hooks/useAgentProfiles';
import { useDispatch } from '@/shared/hooks/useDispatch';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { deleteSessionFolder, generateSessionId } from '@/shared/lib/session';
import { parseJsonArray } from '@/shared/lib/utils';
import type { ChipDefinition } from '@/shared/modes/types';
import { useMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

export function HomePage() {
  return (
    <SidebarProvider>
      <HomeContent />
    </SidebarProvider>
  );
}

function HomeContent() {
  const { t, tt } = useLanguage();
  const { activeMode } = useMode();
  const settings = useSettingsValue();
  const navigate = useNavigate();
  const location = useLocation();

  // Read project context from navigation state (e.g., "New Task" from ProjectDetail)
  const projectState = location.state as {
    projectId?: string;
    projectWorkspace?: string;
    projectName?: string;
    preSelectProfileId?: string;
  } | null;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [workDirs, setWorkDirs] = useState<string[]>(
    projectState?.projectWorkspace ? [projectState.projectWorkspace] : [],
  );
  const [selectedModel, setSelectedModel] = useState(
    settings.lastSelectedChatModel || DEFAULT_MODEL_ID,
  );
  const [prefillValue, setPrefillValue] = useState('');
  const [prefillNonce, setPrefillNonce] = useState(0);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const { profiles } = useAgentProfiles('active');
  const { active: activePlugin, clearSeed: clearPluginSeed } =
    useActivePlugin();
  const seededPluginRef = useRef<string | null>(null);

  // Auto-select profile: preSelectProfileId (from OrgView nav) takes priority,
  // then fall back to activeProfileId from quickstart settings
  useEffect(() => {
    if (selectedProfileId || !profiles.length) return;
    const preId = projectState?.preSelectProfileId;
    if (preId && profiles.some((p) => p.id === preId)) {
      handleProfileChange(preId);
      return;
    }
    if (preId) return; // preSelect was set but profile not found — don't fall through
    let cancelled = false;
    getSettingItem('activeProfileId').then((id) => {
      if (cancelled || !id) return;
      if (profiles.some((p) => p.id === id)) {
        handleProfileChange(id);
      }
    });
    return () => {
      cancelled = true;
    };
    // Only run once after profiles load — intentionally excludes handleProfileChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  // Resolved profile object (null when none selected)
  const selectedProfile = selectedProfileId
    ? (profiles.find((p) => p.id === selectedProfileId) ?? null)
    : null;

  // When profile changes, auto-switch model if the profile has one
  const handleProfileChange = useCallback(
    (profileId: string) => {
      setSelectedProfileId(profileId);
      const profile = profiles.find((p) => p.id === profileId);
      if (profile?.default_model) {
        setSelectedModel(profile.default_model);
        saveSettings({
          ...getSettings(),
          lastSelectedChatModel: profile.default_model,
        });
      }
    },
    [profiles],
  );

  // Memoize profile-derived values to prevent new array refs on every render
  const profileMcpServers = useMemo(
    () =>
      selectedProfile
        ? parseJsonArray(selectedProfile.default_mcp_servers)
        : undefined,
    [selectedProfile],
  );
  const profileSkills = useMemo(
    () =>
      selectedProfile
        ? parseJsonArray(selectedProfile.default_skills)
        : undefined,
    [selectedProfile],
  );

  // Build a human-readable summary of what the profile contributes
  const profileSummary = useMemo(() => {
    if (!selectedProfile) return null;
    const parts: string[] = [];
    if (selectedProfile.system_prompt) parts.push('System prompt');
    if (selectedProfile.default_model) parts.push('Model');
    if (profileMcpServers && profileMcpServers.length > 0)
      parts.push(
        `${profileMcpServers.length} MCP server${profileMcpServers.length > 1 ? 's' : ''}`,
      );
    if (profileSkills && profileSkills.length > 0)
      parts.push(
        `${profileSkills.length} skill${profileSkills.length > 1 ? 's' : ''}`,
      );
    return parts;
  }, [selectedProfile, profileMcpServers, profileSkills]);

  // Seed the composer with a plugin's example query when arriving via "Use"
  // (?plugin=…&seed=1). Guard with a ref so each plugin seeds at most once and
  // clear the seed flag afterwards so the user's edits aren't overwritten.
  useEffect(() => {
    if (!activePlugin?.seed || !activePlugin.exampleQuery) return;
    if (seededPluginRef.current === activePlugin.plugin.id) return;
    seededPluginRef.current = activePlugin.plugin.id;
    setPrefillValue(activePlugin.exampleQuery);
    setPrefillNonce((n) => n + 1);
    clearPluginSeed();
  }, [activePlugin, clearPluginSeed]);

  // Subscribe to background tasks
  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks(setBackgroundTasks);
    return unsubscribe;
  }, []);

  // Load tasks for sidebar
  useEffect(() => {
    async function loadTasks() {
      try {
        const allTasks = await getAllTasks();
        setTasks(allTasks);
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to load tasks:', error);
      }
    }
    loadTasks();
  }, []);

  // Handle task deletion — wrapped in useCallback since it's passed as a prop to LeftSidebar
  const handleDeleteTask = useCallback(
    async (taskId: string, deleteFolder?: boolean) => {
      try {
        // Get task info before deleting (to get session_id)
        const task = await getTask(taskId);

        // Delete task from database
        await deleteTask(taskId);
        setTasks((prev) => prev.filter((t) => t.id !== taskId));

        // Delete session folder if requested (best-effort, errors are logged internally)
        // Pass per-task work_dir so the correct folder is targeted
        if (deleteFolder && task) {
          await deleteSessionFolder(task.id, task.work_dir, task.session_id);
        }
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to delete task:', error);
      }
    },
    [],
  );

  // Handle favorite toggle — wrapped in useCallback so child components
  // that are memoized (e.g. FileCard) don't re-render when unrelated state changes.
  const handleToggleFavorite = useCallback(
    async (taskId: string, favorite: boolean) => {
      try {
        await updateTask(taskId, { favorite });
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, favorite } : t)),
        );
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to update task:', error);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (
      text: string,
      attachments?: MessageAttachment[],
      mentionedMcpServers?: string[],
      pinnedSkills?: string[],
    ) => {
      if (!text.trim() && (!attachments || attachments.length === 0)) return;

      // Resolve agent profile — merge its config into the request
      const profile = selectedProfileId
        ? profiles.find((p) => p.id === selectedProfileId)
        : undefined;

      const finalPrompt = text.trim();

      // Profile model override takes precedence over UI model selector
      const effectiveModel = profile?.default_model || selectedModel;

      // Merge profile MCP servers with user-selected ones
      const pMcp = profileMcpServers ?? [];
      const mergedMcpServers = [
        ...new Set([...pMcp, ...(mentionedMcpServers || [])]),
      ];

      // Merge profile skills with user-selected ones
      const pSkills = profileSkills ?? [];
      const mergedSkills = [...new Set([...pSkills, ...(pinnedSkills || [])])];

      // Create a new session
      const sessionId = generateSessionId(finalPrompt);
      try {
        await createSession({ id: sessionId, prompt: finalPrompt });
      } catch (error) {
        if (import.meta.env.DEV)
          console.error('[Home] Failed to create session:', error);
      }

      // Generate task ID and navigate with attachments
      const taskId = randomUUID();

      navigate(`/task-v2/${taskId}`, {
        state: {
          prompt: finalPrompt,
          sessionId,
          taskIndex: 1,
          attachments,
          workDir: workDirs[0] ?? undefined,
          additionalWorkDirs:
            workDirs.length > 1 ? workDirs.slice(1) : undefined,
          modelOverride: buildModelOverride(effectiveModel),
          mentionedMcpServers:
            mergedMcpServers.length > 0 ? mergedMcpServers : undefined,
          pinnedSkills: mergedSkills.length > 0 ? mergedSkills : undefined,
          projectId: projectState?.projectId,
          assigneeProfileId: selectedProfileId || undefined,
          profileDisplay: profile
            ? {
                id: profile.id,
                name: profile.name,
                role: profile.role,
                avatarIcon: profile.avatar_icon,
                avatarColor: profile.avatar_color,
                defaultModel: profile.default_model,
                systemPrompt: profile.system_prompt,
                mcpServerCount: profileMcpServers?.length ?? 0,
                skillCount: profileSkills?.length ?? 0,
              }
            : undefined,
        },
      });
    },
    [
      navigate,
      workDirs,
      selectedModel,
      projectState?.projectId,
      selectedProfileId,
      profiles,
      profileMcpServers,
      profileSkills,
    ],
  );

  // Dispatch hook — background task execution
  const { dispatch: dispatchTask } = useDispatch({
    workDirs,
    selectedModel,
    profileId: selectedProfileId || undefined,
    profileMcpServers: profileMcpServers ?? undefined,
    profileSkills: profileSkills ?? undefined,
  });

  const handleTemplateSelect = useCallback((template: AssistantTemplate) => {
    setTemplateDialogOpen(false);
    // Prefill the first starter prompt so the user can send immediately
    if (template.starterPrompts.length > 0) {
      setPrefillValue(template.starterPrompts[0]);
      setPrefillNonce((n) => n + 1);
    }
  }, []);

  const handleStarterChip = useCallback(
    (chip: ChipDefinition) => {
      if (chip.action.kind === 'nav') {
        navigate(chip.action.href);
        return;
      }
      const prompt = chip.action.promptKey
        ? tt(chip.action.promptKey)
        : chip.action.prompt;
      setPrefillValue(prompt);
      setPrefillNonce((n) => n + 1);
    },
    [navigate, tt],
  );

  return (
    <div
      className="bg-sidebar flex h-screen overflow-hidden"
      data-testid="home-page"
    >
      {/* Left Sidebar */}
      <LeftSidebar
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={backgroundTasks
          .filter((t) => t.isRunning)
          .map((t) => t.taskId)}
      />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        <BudgetBanner />
        {/* Content Area — vertically centered */}
        <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-4 py-6">
          <ParallelTaskDashboard />
          <BackgroundTasksSection />
          <motion.div
            className="flex w-full max-w-2xl flex-col items-center gap-6"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: { staggerChildren: STAGGER.slow },
              },
            }}
          >
            <motion.div
              className="text-center"
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: { duration: DURATION.slow, ease: EASE.out },
                },
              }}
            >
              <HomeGreeting />
            </motion.div>

            {/* Input Box — slides up after title */}
            <motion.div
              className="w-full"
              variants={{
                hidden: { opacity: 0, y: 16 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: DURATION.moderate, ease: EASE.out },
                },
              }}
            >
              {/* Project context badge */}
              {projectState?.projectName && (
                <div className="bg-accent/50 border-border mb-2 flex items-center gap-2 self-start rounded-lg border px-3 py-1.5 text-sm">
                  <div className="size-2.5 rounded-full bg-indigo-500" />
                  <span className="text-foreground font-medium">
                    {projectState.projectName}
                  </span>
                  <button
                    type="button"
                    aria-label={t.common.close}
                    onClick={() => navigate('/', { replace: true })}
                    className="text-muted-foreground hover:text-foreground ml-1 transition-colors"
                  >
                    &times;
                  </button>
                </div>
              )}
              <div className="flex justify-center">
                <ActivePluginChip className="mb-2" />
              </div>
              <ChatInput
                variant="home"
                onSubmit={handleSubmit}
                onDispatch={dispatchTask}
                className="w-full"
                autoFocus
                workDirs={workDirs}
                onWorkDirsChange={setWorkDirs}
                showFolderPicker
                selectedModel={selectedModel}
                onModelChange={(modelId: string) => {
                  setSelectedModel(modelId);
                  saveSettings({
                    ...getSettings(),
                    lastSelectedChatModel: modelId,
                  });
                }}
                initialValue={prefillValue}
                initialValueNonce={prefillNonce}
                initialMcpServers={profileMcpServers}
                initialSkills={profileSkills}
              />

              <div className="mt-3">
                <StarterChips
                  chips={activeMode.composer?.starterChips ?? []}
                  onSelect={handleStarterChip}
                />
              </div>

              {/* Agent profile + Template row */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {/* Agent profile picker — pill buttons */}
                {profiles.length > 0 &&
                  (selectedProfile ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProfileId('');
                        setSelectedModel(
                          settings.lastSelectedChatModel || DEFAULT_MODEL_ID,
                        );
                      }}
                      className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1.5 rounded-full border py-1 pr-2 pl-1 text-xs font-medium transition-colors"
                    >
                      <AvatarSvg
                        avatarId={selectedProfile.avatar_icon}
                        color={selectedProfile.avatar_color || '#6366f1'}
                        className="size-5 shrink-0 overflow-hidden rounded-full"
                      />
                      {selectedProfile.name}
                      {profileSummary && profileSummary.length > 0 && (
                        <span className="text-primary/60 text-[10px] font-normal">
                          {profileSummary.join(' · ')}
                        </span>
                      )}
                      <XIcon className="size-3 opacity-60" />
                    </button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-transparent py-1 pr-2.5 pl-2 text-xs transition-colors focus:outline-none"
                        >
                          <User className="size-3.5" />
                          {t.profiles.noAgent}
                          <ChevronDown className="size-3 opacity-60" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-48">
                        <DropdownMenuItem
                          onSelect={() => handleProfileChange('')}
                          className="gap-2 text-xs"
                        >
                          <User className="text-muted-foreground size-4" />
                          <span className="text-muted-foreground">
                            {t.profiles.noAgent}
                          </span>
                        </DropdownMenuItem>
                        {profiles.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onSelect={() => handleProfileChange(p.id)}
                            className="gap-2 text-xs"
                          >
                            <AvatarSvg
                              avatarId={p.avatar_icon}
                              color={p.avatar_color || '#6366f1'}
                              className="size-5 shrink-0 overflow-hidden rounded-full"
                            />
                            {p.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ))}

                <button
                  type="button"
                  onClick={() => setTemplateDialogOpen(true)}
                  className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors"
                >
                  <BookTemplate className="size-3.5" />
                  {t.templates.startWithTemplate}
                </button>
              </div>
            </motion.div>

            {/* Quick action categories — below chat input */}
            <motion.div
              className="w-full"
              variants={{
                hidden: { opacity: 0, y: 16 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: {
                    duration: DURATION.moderate,
                    ease: EASE.out,
                    delay: STAGGER.slow * 4,
                  },
                },
              }}
            >
              <QuickActions
                onSelectPrompt={(prompt) => {
                  setPrefillValue(prompt);
                  setPrefillNonce((n) => n + 1);
                }}
              />
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Template Gallery Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.templates.gallery}</DialogTitle>
          </DialogHeader>
          <TemplateGallery
            onSelect={handleTemplateSelect}
            onClose={() => setTemplateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
