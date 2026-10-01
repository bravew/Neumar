import { useCallback, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { ScopingCard } from '@/components/ideas/ScopingCard';
import {
  createMessage,
  createSession,
  createTask,
  getMessagesByTaskId,
} from '@/shared/db';
import type { Message } from '@/shared/db';
import {
  IDEAS_PREFILL_EVENT,
  takeComposerPrefill,
} from '@/shared/ideas/prefill';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

import { ContextChip } from './ContextChip';
import { usePageContextValue } from './usePageContext';

export function ChatDock({
  taskId,
  onTaskId,
  onClose,
}: {
  taskId: string | null;
  onTaskId: (taskId: string) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const pageContext = usePageContextValue();
  const [dismissedPayload, setDismissedPayload] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [scopeQuestions, setScopeQuestions] = useState<string[] | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const chip =
    pageContext && pageContext.payload !== dismissedPayload
      ? pageContext
      : null;

  const load = useCallback(async (id: string) => {
    setMessages(await getMessagesByTaskId(id));
  }, []);

  useEffect(() => {
    if (!taskId) return;
    void load(taskId);
  }, [load, taskId]);

  useEffect(() => {
    // An open dock claims the prompt so Home does not also receive it.
    const onPrefill = () => {
      const prompt = takeComposerPrefill();
      if (prompt !== null) setDraft(prompt);
    };
    const onScope = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (Array.isArray(detail?.questions)) setScopeQuestions(detail.questions);
    };
    window.addEventListener(IDEAS_PREFILL_EVENT, onPrefill);
    window.addEventListener('automation:scope', onScope);
    return () => {
      window.removeEventListener(IDEAS_PREFILL_EVENT, onPrefill);
      window.removeEventListener('automation:scope', onScope);
    };
  }, []);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    const content = chip ? `${chip.payload}\n\n${text}` : text;
    setDraft('');
    let id = taskId;
    if (!id) {
      const sessionId = randomUUID();
      id = randomUUID();
      await createSession({ id: sessionId, prompt: content });
      await createTask({
        id,
        session_id: sessionId,
        task_index: 0,
        prompt: content,
      });
      onTaskId(id);
    }
    await createMessage({ task_id: id, type: 'user', content });
    await load(id);
  };

  return (
    <aside
      data-testid="chat-dock"
      className="border-border flex h-full w-[360px] max-w-[560px] min-w-[320px] shrink-0 flex-col border-r"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-sm font-medium">{t.task.dockTitle}</p>
        <button type="button" className="text-xs" onClick={onClose}>
          {t.task.dockClose}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3">
        {(taskId ? messages : []).map((message) => (
          <p key={message.id} className="text-sm whitespace-pre-wrap">
            {message.content}
          </p>
        ))}
      </div>
      <form
        className="space-y-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {scopeQuestions ? (
          <ScopingCard
            title={t.task.dockTitle}
            questions={scopeQuestions.slice(0, 3)}
            onSubmit={(answers) => {
              setDraft(answers.filter(Boolean).join('\n'));
              setScopeQuestions(null);
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
        {taskId ? (
          <button
            type="button"
            className="text-primary text-xs"
            onClick={() => navigate(`/task-v2/${taskId}`)}
          >
            {t.task.dockFullView}
          </button>
        ) : null}
      </form>
    </aside>
  );
}
