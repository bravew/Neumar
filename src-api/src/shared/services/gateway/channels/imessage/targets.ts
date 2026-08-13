export type IMessageTarget =
  | { kind: 'chat_guid'; chatGuid: string }
  | { kind: 'phone'; handle: string }
  | { kind: 'email'; handle: string };

export function parseIMessageTarget(raw: string): IMessageTarget {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('iMessage target is required');
  const withoutProvider = trimmed
    .replace(/^(imessage|bluebubbles):/i, '')
    .trim();
  const lower = withoutProvider.toLowerCase();

  if (lower.startsWith('chat_guid:') || lower.startsWith('guid:')) {
    const value = withoutProvider
      .slice(withoutProvider.indexOf(':') + 1)
      .trim();
    if (!value) throw new Error('chat_guid target requires a value');
    return { kind: 'chat_guid', chatGuid: value };
  }

  if (isRawChatGuid(withoutProvider)) {
    return { kind: 'chat_guid', chatGuid: withoutProvider };
  }

  if (lower.startsWith('phone:')) {
    const phone = normalizeHandle(withoutProvider.slice('phone:'.length));
    if (!/^\+\d{7,15}$/.test(phone)) {
      throw new Error('iMessage phone target must be phone:+E164');
    }
    return { kind: 'phone', handle: phone };
  }

  if (lower.startsWith('email:')) {
    const email = normalizeHandle(withoutProvider.slice('email:'.length));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error('iMessage email target must be email:name@example.com');
    }
    return { kind: 'email', handle: email };
  }

  if (withoutProvider.includes('@')) {
    return { kind: 'email', handle: normalizeHandle(withoutProvider) };
  }

  const phone = normalizeHandle(withoutProvider);
  if (/^\+\d{7,15}$/.test(phone)) return { kind: 'phone', handle: phone };
  throw new Error('iMessage target must be a chat GUID, phone:+E164, or email');
}

export async function resolveIMessageChatGuid(params: {
  serverUrl: string;
  password: string;
  target: IMessageTarget;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Promise<string> {
  if (params.target.kind === 'chat_guid') return params.target.chatGuid;
  const fetchFn = params.fetchFn ?? fetch;
  const url = new URL('/api/v1/chat/query', params.serverUrl);
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      password: params.password,
    },
    body: JSON.stringify({
      limit: 500,
      offset: 0,
      with: ['participants'],
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? 15_000),
  });
  if (!response.ok) {
    throw new Error(`BlueBubbles chat lookup failed: ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: unknown[];
  } | null;
  const needle = normalizeHandle(params.target.handle);
  for (const chat of payload?.data ?? []) {
    const record = isRecord(chat) ? chat : null;
    const participants = participantHandles(record);
    if (participants.some((item) => normalizeHandle(item) === needle)) {
      const guid =
        stringValue(record, 'guid') ?? stringValue(record, 'chatGuid');
      if (guid) return guid;
    }
  }
  throw new Error(`No BlueBubbles chat found for ${params.target.handle}`);
}

function isRawChatGuid(value: string): boolean {
  const parts = value.split(';');
  return parts.length === 3 && Boolean(parts[0] && parts[1] && parts[2]);
}

function normalizeHandle(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return trimmed.replace(/[\s().-]/g, '');
}

function participantHandles(chat: Record<string, unknown> | null): string[] {
  const raw = chat?.participants ?? chat?.handles ?? chat?.participantHandles;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!isRecord(entry)) return '';
      return (
        stringValue(entry, 'address') ??
        stringValue(entry, 'handle') ??
        stringValue(entry, 'id') ??
        stringValue(entry, 'identifier') ??
        ''
      );
    })
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(
  value: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item.trim() : undefined;
}
