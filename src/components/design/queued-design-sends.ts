import { randomUUID } from '@/shared/utils/uuid';

const STORAGE_KEY_PREFIX = 'neuma-design-queued-sends:v1:';
const MAX_STORED_ITEMS = 50;
const MAX_STORED_PROMPT_CHARS = 50_000;
const MAX_STORED_ERROR_CHARS = 1_000;

export type QueuedDesignSendStatus = 'queued' | 'failed';

export interface QueuedDesignSend {
  id: string;
  prompt: string;
  createdAt: string;
  status: QueuedDesignSendStatus;
  error?: string;
  failedAt?: string;
}

export function createQueuedDesignSend(prompt: string): QueuedDesignSend {
  return {
    id: randomUUID(),
    prompt,
    createdAt: new Date().toISOString(),
    status: 'queued',
  };
}

export function queuedDesignSendsStorageKey(projectId: string) {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(projectId)}`;
}

export function loadQueuedDesignSends(projectId: string): QueuedDesignSend[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(queuedDesignSendsStorageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_STORED_ITEMS)
      .map(normalizeQueuedDesignSend)
      .filter((item): item is QueuedDesignSend => Boolean(item));
  } catch {
    return [];
  }
}

export function persistQueuedDesignSends(
  projectId: string,
  queuedSends: QueuedDesignSend[],
) {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    const key = queuedDesignSendsStorageKey(projectId);
    if (queuedSends.length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(
      key,
      JSON.stringify(
        queuedSends.slice(0, MAX_STORED_ITEMS).map(serializeQueuedDesignSend),
      ),
    );
  } catch {
    // Local persistence is best-effort; keep the in-memory queue usable.
  }
}

export function markQueuedDesignSendFailed(
  item: QueuedDesignSend,
  error?: string,
): QueuedDesignSend {
  return {
    ...item,
    status: 'failed',
    error: cleanOptionalString(error, MAX_STORED_ERROR_CHARS),
    failedAt: new Date().toISOString(),
  };
}

export function retryQueuedDesignSend(
  item: QueuedDesignSend,
): QueuedDesignSend {
  return {
    id: item.id,
    prompt: item.prompt,
    createdAt: item.createdAt,
    status: 'queued',
  };
}

function normalizeQueuedDesignSend(value: unknown): QueuedDesignSend | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = cleanOptionalString(record.id, 200);
  const prompt = cleanOptionalString(record.prompt, MAX_STORED_PROMPT_CHARS);
  if (!id || !prompt) return null;
  const status: QueuedDesignSendStatus =
    record.status === 'failed' ? 'failed' : 'queued';
  const error = cleanOptionalString(record.error, MAX_STORED_ERROR_CHARS);
  const failedAt = cleanOptionalString(record.failedAt, 80);
  return {
    id,
    prompt,
    createdAt: cleanOptionalString(record.createdAt, 80) ?? '',
    status,
    ...(status === 'failed' && error ? { error } : {}),
    ...(status === 'failed' && failedAt ? { failedAt } : {}),
  };
}

function serializeQueuedDesignSend(item: QueuedDesignSend) {
  return {
    id: item.id,
    prompt: item.prompt,
    createdAt: item.createdAt,
    status: item.status,
    ...(item.error ? { error: item.error } : {}),
    ...(item.failedAt ? { failedAt: item.failedAt } : {}),
  };
}

function cleanOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
