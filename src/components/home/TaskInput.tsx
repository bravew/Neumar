import { useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { FileText, Globe, Palette, Smartphone } from 'lucide-react';
import { nanoid } from 'nanoid';

import { ChatInput } from '@/components/shared/ChatInput';
import { StaggeredText } from '@/config/animation';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useAgent } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { AgentMessages } from './AgentMessages';

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  prompt?: string;
}

// Stable icon elements — extracted outside the component so they are created
// once and never cause useMemo to produce new objects on re-render.
const ICON_SLIDES = <FileText className="size-4" />;
const ICON_WEBSITE = <Globe className="size-4" />;
const ICON_APPS = <Smartphone className="size-4" />;
const ICON_DESIGN = <Palette className="size-4" />;

export function TaskInput() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { messages, isRunning, runAgent, stopAgent, setSessionInfo } =
    useAgent();
  const [composerFocusNonce, setComposerFocusNonce] = useState(0);

  useEffect(() => {
    const handler = () => setComposerFocusNonce((n) => n + 1);
    window.addEventListener('tasks:focus-composer', handler);
    return () => window.removeEventListener('tasks:focus-composer', handler);
  }, []);

  // Build quick actions from i18n — memoized to avoid re-creating on every render
  const quickActions: QuickAction[] = useMemo(
    () => [
      {
        icon: ICON_SLIDES,
        label: t.home.quickActions.createSlides,
        prompt: t.home.quickActions.createSlidesPrompt,
      },
      {
        icon: ICON_WEBSITE,
        label: t.home.quickActions.buildWebsite,
        prompt: t.home.quickActions.buildWebsitePrompt,
      },
      {
        icon: ICON_APPS,
        label: t.home.quickActions.developApps,
        prompt: t.home.quickActions.developAppsPrompt,
      },
      {
        icon: ICON_DESIGN,
        label: t.home.quickActions.design,
        prompt: t.home.quickActions.designPrompt,
      },
      { icon: null, label: t.home.quickActions.more },
    ],
    [t.home.quickActions],
  );

  const handleSubmit = async (
    text: string,
    attachments?: MessageAttachment[],
    mentionedMcpServers?: string[],
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    // Generate session info
    const sessionId = nanoid(10);
    const taskIndex = 1;
    const taskId = `${sessionId}-task-${String(taskIndex).padStart(2, '0')}`;

    // Set session info before running agent
    setSessionInfo(sessionId, taskIndex);

    // Run the agent with prompt and attachments
    // When images are attached, runAgent will use direct execution (skip planning)
    await runAgent(
      text,
      taskId,
      { sessionId, taskIndex },
      attachments,
      undefined,
      undefined,
      mentionedMcpServers,
    );

    // Navigate to task detail page with attachments in state
    navigate(`/task-v2/${taskId}`, {
      state: {
        prompt: text,
        sessionId,
        taskIndex,
        attachments,
      },
    });
  };

  const handleQuickAction = async (action: QuickAction) => {
    if (action.prompt && !isRunning) {
      await handleSubmit(action.prompt);
    }
  };

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
      {/* Title */}
      <h1 className="gradient-text-ai font-serif text-4xl font-medium">
        <StaggeredText text={t.home.welcomeTitle} />
      </h1>

      {/* Input Box - Using shared ChatInput component */}
      <ChatInput
        key={composerFocusNonce}
        autoFocus={composerFocusNonce > 0}
        variant="home"
        placeholder={t.home.inputPlaceholder}
        isRunning={isRunning}
        onSubmit={handleSubmit}
        onStop={stopAgent}
        className="w-full"
      />

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => handleQuickAction(action)}
            disabled={isRunning}
            aria-label={
              action.prompt ? `${action.label}: ${action.prompt}` : action.label
            }
            className={cn(
              'border-border bg-background text-muted-foreground flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors',
              isRunning
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-accent hover:text-foreground',
            )}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* Agent Messages */}
      <AgentMessages messages={messages} isRunning={isRunning} />
    </div>
  );
}
