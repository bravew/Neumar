import { useState } from 'react';

import {
  createMessage,
  createSession,
  createTask,
  updateTask,
} from '@/shared/db';
import { useSettingsValue } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

import { sideChatDraft, type SideChatItem } from './side-chat';

export function AskAboutThis({ item }: { item: SideChatItem }) {
  const { t } = useLanguage();
  const simpleShell = useSettingsValue().ui.simpleShell;
  const [pending, setPending] = useState(false);
  if (!simpleShell) return null;

  return (
    <button
      type="button"
      data-testid={`ask-about-${item.kind}`}
      className="text-primary text-xs"
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        setPending(true);
        void startSideChat(item).finally(() => setPending(false));
      }}
    >
      {t.task.askAboutThis}
    </button>
  );
}

export async function startSideChat(item: SideChatItem): Promise<string> {
  const draft = sideChatDraft(item);
  const sessionId = randomUUID();
  const taskId = randomUUID();
  await createSession({ id: sessionId, prompt: draft.payload });
  await createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 0,
    prompt: draft.payload,
  });
  await updateTask(taskId, { title: draft.title });
  await createMessage({
    task_id: taskId,
    type: 'user',
    content: draft.payload,
  });
  window.dispatchEvent(
    new CustomEvent('shell:open-dock', { detail: { taskId } }),
  );
  return taskId;
}
