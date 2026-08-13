export interface TelegramTarget {
  chatId: string;
  threadId?: number;
}

export function parseTelegramTarget(raw: string): TelegramTarget {
  const trimmed = raw.trim();
  const topicMatch = /^(.+?):topic:(\d+)$/.exec(trimmed);
  if (topicMatch) {
    return {
      chatId: topicMatch[1]!,
      threadId: Number.parseInt(topicMatch[2]!, 10),
    };
  }

  const colonMatch = /^(.+):(\d+)$/.exec(trimmed);
  if (colonMatch) {
    return {
      chatId: colonMatch[1]!,
      threadId: Number.parseInt(colonMatch[2]!, 10),
    };
  }

  return { chatId: trimmed };
}

export function telegramSendOptions(
  target: TelegramTarget,
): Record<string, unknown> {
  return target.threadId ? { message_thread_id: target.threadId } : {};
}
