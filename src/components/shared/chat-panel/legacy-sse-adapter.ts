import { randomUUID } from '@/shared/utils/uuid';

import type { ChatPanelAction, ChatPanelMessage } from './types';

export interface ChatPanelLegacySseFrame {
  event: string;
  data: string;
}

export interface ChatPanelLegacySseOptions {
  now?: () => string;
  createId?: (prefix: string) => string;
}

export function normalizeLegacySseFrame(
  frame: ChatPanelLegacySseFrame,
  options: ChatPanelLegacySseOptions = {},
): ChatPanelMessage | null {
  const payload = parseJsonRecord(frame.data);
  if (!payload) return null;
  const now = options.now ?? (() => new Date().toISOString());
  const createId =
    options.createId ?? ((prefix: string) => `${prefix}:${randomUUID()}`);

  if (frame.event === 'message') {
    const content = getString(payload, 'content');
    if (!content) return null;
    return {
      id: getString(payload, 'id') ?? createId('legacy-message'),
      kind: 'text',
      role: 'assistant',
      content,
      createdAt: now(),
    };
  }

  if (frame.event === 'error') {
    const content = getString(payload, 'message') ?? 'Agent stream failed';
    return {
      id: getString(payload, 'id') ?? createId('legacy-error'),
      kind: 'text',
      role: 'system',
      content,
      createdAt: now(),
      isError: true,
      subtype: 'legacy_error',
    };
  }

  if (frame.event === 'action') {
    return buildActionMessage(payload, now, createId);
  }

  if (frame.event === 'permission_request') {
    const permission = getRecord(payload, 'permission');
    if (!permission) return null;
    return buildActionMessage(
      {
        id: getString(permission, 'id'),
        name: getString(permission, 'tool') ?? 'permission',
        summary: getString(permission, 'description'),
        args: parseJsonValue(getString(permission, 'command') ?? '') ?? {},
        status: 'pending',
        requiresApproval: true,
        payload,
      },
      now,
      createId,
    );
  }

  return null;
}

export function normalizeLegacySseFrames(
  frames: ChatPanelLegacySseFrame[],
  options: ChatPanelLegacySseOptions = {},
): ChatPanelMessage[] {
  return frames.flatMap((frame) => {
    const message = normalizeLegacySseFrame(frame, options);
    return message ? [message] : [];
  });
}

function buildActionMessage(
  payload: Record<string, unknown>,
  now: () => string,
  createId: (prefix: string) => string,
): ChatPanelMessage | null {
  const name = getString(payload, 'name') ?? getString(payload, 'type');
  if (!name) return null;
  const action: ChatPanelAction = {
    id: getString(payload, 'id') ?? createId('legacy-action'),
    name,
    summary: getString(payload, 'summary'),
    args: getRecord(payload, 'args') ?? {},
    status: getString(payload, 'status'),
    requiresApproval: getBoolean(payload, 'requiresApproval'),
    payload,
  };
  return {
    id: action.id,
    kind: 'action',
    role: 'assistant',
    action,
    createdAt: now(),
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(value);
  return isPlainObject(parsed) ? parsed : null;
}

function parseJsonValue(value: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const item = value[key];
  return isPlainObject(item) ? item : undefined;
}

function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === 'string' ? item : undefined;
}

function getBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const item = value[key];
  return typeof item === 'boolean' ? item : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
