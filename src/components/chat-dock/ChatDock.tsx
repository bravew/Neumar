import { lazy, Suspense, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { ChevronDown, MessagesSquare } from 'lucide-react';

import { ScopingCard } from '@/components/ideas/ScopingCard';
import { useSidebarTasks } from '@/components/layout/sidebar-shell/useSidebarTasks';
import {
  AUTOMATION_SCOPE_EVENT,
  takeAutomationScope,
} from '@/shared/automation/scope-request';
import { createSession, createTask } from '@/shared/db';
import {
  IDEAS_PREFILL_EVENT,
  takeComposerPrefill,
} from '@/shared/ideas/prefill';
import { markPendingFirstPrompt } from '@/shared/lib/pending-initial-prompt';
import { generateSessionId } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

import { ContextChip } from './ContextChip';
import { DockSessionList, sessionLabel } from './DockSessionList';
import { usePageContextValue } from './usePageContext';

// CopilotKit stays in its own chunk, loaded when the dock first shows a
// thread, instead of joining the always-mounted shell's bundle.
const DockThread = lazy(() =>
  import('./DockThread').then((module) => ({ default: module.DockThread })),
);

export function ChatDock({
  taskId,
  pageTaskId,
  onTaskId,
  onClose,
}: {
  taskId: string | null;
  /** The task the page itself shows; the dock never mounts a second copy. */
  pageTaskId?: string;
  onTaskId: (taskId: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const pageContext = usePageContextValue();
  const [dismissedPayload, setDismissedPayload] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<{
    category: string;
    questions: string[];
  } | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Set once the user picks New chat, so opening on the latest session never
  // overrides that choice.
  const [startedNew, setStartedNew] = useState(false);
  const { tasks, status, reload } = useSidebarTasks();
  const latestId = tasks.find((task) => task.id !== pageTaskId)?.id;
  const current = taskId ? tasks.find((task) => task.id === taskId) : undefined;
  const chip =
    pageContext && pageContext.payload !== dismissedPayload
      ? pageContext
      : null;

  // Spec §2: the dock opens on the most recent conversation.
  useEffect(() => {
    if (taskId || startedNew || status !== 'ready' || !latestId) return;
    onTaskId(latestId);
  }, [latestId, onTaskId, startedNew, status, taskId]);

  const startNewChat = () => {
    setStartedNew(true);
    onTaskId(null);
    setListOpen(false);
  };

  useEffect(() => {
    // An open dock claims the prompt so Home does not also receive it. It
    // lands in a new chat rather than a session the user did not pick.
    const onPrefill = () => {
      const prompt = takeComposerPrefill();
      if (prompt === null) return;
      setStartedNew(true);
      onTaskId(null);
      setListOpen(false);
      setDraft(prompt);
    };
    // A request made while the dock was closed waits in the registry, so it is
    // claimed on mount as well as from the event.
    const onScope = () => {
      const request = takeAutomationScope();
      if (request === null) return;
      setStartedNew(true);
      onTaskId(null);
      setListOpen(false);
      setScope(request);
    };
    onScope();
    window.addEventListener(IDEAS_PREFILL_EVENT, onPrefill);
    window.addEventListener(AUTOMATION_SCOPE_EVENT, onScope);
    return () => {
      window.removeEventListener(IDEAS_PREFILL_EVENT, onPrefill);
      window.removeEventListener(AUTOMATION_SCOPE_EVENT, onScope);
    };
  }, [onTaskId]);

  // Same creation path as Home: session and task rows first, then the thread
  // sends the prompt through the agent runtime.
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    const content = chip ? `${chip.payload}\n\n${text}` : text;
    const sessionId = generateSessionId(content);
    const id = randomUUID();
    await createSession({ id: sessionId, prompt: content });
    await createTask({
      id,
      session_id: sessionId,
      task_index: 1,
      prompt: content,
    });
    // Record the handoff before the thread mounts. The registry outlives this
    // component, so closing the dock or switching chats before the lazy thread
    // connects no longer drops the prompt and leaves an unstarted task.
    markPendingFirstPrompt(id, content);
    setDraft('');
    if (chip) setDismissedPayload(chip.payload);
    onTaskId(id);
    reload();
  };

  const body = () => {
    if (listOpen) {
      return (
        <DockSessionList
          tasks={tasks}
          status={status}
          activeId={taskId}
          onSelect={(id) => {
            onTaskId(id);
            setListOpen(false);
          }}
          onNewChat={startNewChat}
        />
      );
    }
    if (taskId && taskId === pageTaskId) {
      return (
        <p className="text-muted-foreground px-3 py-2 text-sm">
          {t.task.dockOpenInPage}
        </p>
      );
    }
    if (taskId) {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          {chip ? (
            <div className="px-3 pb-2">
              <ContextChip
                label={chip.label}
                removeLabel={t.task.dockDismiss}
                onRemove={() => setDismissedPayload(chip.payload)}
              />
            </div>
          ) : null}
          <Suspense fallback={null}>
            <DockThread
              taskId={taskId}
              promptPrefix={
                chip
                  ? {
                      text: chip.payload,
                      onUsed: () => setDismissedPayload(chip.payload),
                    }
                  : undefined
              }
            />
          </Suspense>
        </div>
      );
    }
    return (
      <form
        className="mt-auto space-y-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {scope ? (
          <ScopingCard
            title={t.task.dockTitle}
            questions={scope.questions.slice(0, 3)}
            onSubmit={(answers) => {
              // Label each answer with its question and lead with the chosen
              // category, so the run keeps what the user picked. The draft is
              // a single-line input that drops newlines, hence the separator.
              const answered = scope.questions
                .slice(0, 3)
                .map((question, index) => [question, answers[index]] as const)
                .filter(([, answer]) => Boolean(answer))
                .map(([question, answer]) => `${question} ${answer}`);
              setDraft(
                [`Automation category: ${scope.category}`, ...answered].join(
                  '; ',
                ),
              );
              setScope(null);
            }}
          />
        ) : null}
        {chip ? (
          <ContextChip
            label={chip.label}
            removeLabel={t.task.dockDismiss}
            onRemove={() => setDismissedPayload(chip.payload)}
          />
        ) : null}
        <input
          data-testid="chat-dock-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.task.dockPlaceholder}
          className="border-input bg-background h-9 w-full rounded-lg border px-3 text-sm"
        />
      </form>
    );
  };

  return (
    <aside
      data-testid="chat-dock"
      className="border-border bg-background flex h-full w-[400px] max-w-[560px] min-w-[320px] shrink-0 flex-col border-r"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={listOpen}
          aria-label={t.task.dockSwitchChat}
          title={t.task.dockSwitchChat}
          onClick={() => {
            if (!listOpen) reload();
            setListOpen((open) => !open);
          }}
          className="hover:bg-sidebar-accent flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium transition-colors"
        >
          <MessagesSquare className="size-4 shrink-0" />
          <span className="truncate">
            {listOpen
              ? t.task.dockChats
              : current
                ? sessionLabel(current)
                : t.task.dockTitle}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 transition-transform',
              listOpen && 'rotate-180',
            )}
          />
        </button>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          {taskId && taskId !== pageTaskId ? (
            <button
              type="button"
              className="text-primary"
              onClick={() => {
                // The page takes over the thread; one runtime per task.
                onClose();
                navigate(`/task-v2/${taskId}`);
              }}
            >
              {t.task.dockFullView}
            </button>
          ) : null}
          <button type="button" onClick={onClose}>
            {t.task.dockClose}
          </button>
        </div>
      </div>
      {body()}
    </aside>
  );
}
