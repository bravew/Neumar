export type ChannelTargetProvider =
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'lark'
  | 'bluebubbles'
  | 'whatsapp';

export interface ParsedChannelTarget {
  provider: ChannelTargetProvider;
  conversationId: string;
  threadId?: string;
  userId?: string;
  receiveIdType?: 'chat_id' | 'open_id' | 'user_id';
  phoneNumberId?: string;
  waId?: string;
}

export function parseChannelTarget(
  provider: ChannelTargetProvider,
  raw: string,
): ParsedChannelTarget {
  const target = raw.trim();
  if (!target) throw new Error(`${provider} target is empty`);

  switch (provider) {
    case 'slack':
      return parseSlackTarget(target);
    case 'discord':
      return parseDiscordTarget(target);
    case 'telegram':
      return parseTelegramTarget(target);
    case 'lark':
      return parseLarkTarget(target);
    case 'bluebubbles':
      return parseBlueBubblesTarget(target);
    case 'whatsapp':
      return parseWhatsAppTarget(target);
  }
}

export function parseSlackTarget(raw: string): ParsedChannelTarget {
  const [conversationId, threadId] = raw.split(':', 2);
  if (!conversationId) throw new Error('Slack target requires a channel id');
  if (!/^[CDG][A-Z0-9]+$/.test(conversationId)) {
    throw new Error(
      'Slack target must be C..., D..., G..., or channel:thread_ts',
    );
  }
  return {
    provider: 'slack',
    conversationId,
    ...(threadId ? { threadId } : {}),
  };
}

export function parseDiscordTarget(raw: string): ParsedChannelTarget {
  if (/^dm:/i.test(raw)) {
    const userId = raw.slice(3).trim();
    if (!userId) throw new Error('Discord dm target requires a user id');
    return { provider: 'discord', conversationId: `dm:${userId}`, userId };
  }

  if (/^forum:/i.test(raw)) {
    const [, forumId, threadId] = raw.split(':');
    if (!forumId || !threadId) {
      throw new Error('Discord forum target must be forum:forumId:threadId');
    }
    return {
      provider: 'discord',
      conversationId: `forum:${forumId}:${threadId}`,
      threadId,
    };
  }

  return { provider: 'discord', conversationId: raw };
}

export function parseTelegramTarget(raw: string): ParsedChannelTarget {
  const match = /^(.+):(\d+)$/.exec(raw);
  if (!match) return { provider: 'telegram', conversationId: raw };
  return {
    provider: 'telegram',
    conversationId: match[1]!,
    threadId: match[2]!,
  };
}

export function parseLarkTarget(raw: string): ParsedChannelTarget {
  const withoutProvider = raw.replace(/^(lark|feishu):/i, '').trim();
  const prefixed = /^(chat|group|channel|user|dm|open_id):/i.exec(
    withoutProvider,
  );
  if (prefixed) {
    const prefix = prefixed[1]!.toLowerCase();
    const value = withoutProvider.slice(prefixed[0].length).trim();
    if (!value) throw new Error(`Lark ${prefix} target requires an id`);
    if (prefix === 'chat' || prefix === 'group' || prefix === 'channel') {
      return {
        provider: 'lark',
        conversationId: value,
        receiveIdType: 'chat_id',
      };
    }
    const receiveIdType = value.startsWith('ou_') ? 'open_id' : 'user_id';
    return {
      provider: 'lark',
      conversationId: value,
      userId: value,
      receiveIdType:
        prefix === 'open_id' || prefix === 'dm' ? 'open_id' : receiveIdType,
    };
  }

  if (withoutProvider.startsWith('oc_')) {
    return {
      provider: 'lark',
      conversationId: withoutProvider,
      receiveIdType: 'chat_id',
    };
  }
  if (withoutProvider.startsWith('ou_')) {
    return {
      provider: 'lark',
      conversationId: withoutProvider,
      userId: withoutProvider,
      receiveIdType: 'open_id',
    };
  }
  return {
    provider: 'lark',
    conversationId: withoutProvider,
    userId: withoutProvider,
    receiveIdType: 'user_id',
  };
}

export function parseBlueBubblesTarget(raw: string): ParsedChannelTarget {
  if (/^phone:/i.test(raw)) {
    const phone = raw.slice('phone:'.length).trim();
    if (!/^\+\d{7,15}$/.test(phone)) {
      throw new Error('BlueBubbles phone target must be phone:+E164');
    }
    return { provider: 'bluebubbles', conversationId: phone, userId: phone };
  }

  if (/^email:/i.test(raw)) {
    const email = raw.slice('email:'.length).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error(
        'BlueBubbles email target must be email:name@example.com',
      );
    }
    return { provider: 'bluebubbles', conversationId: email, userId: email };
  }

  return { provider: 'bluebubbles', conversationId: raw };
}

export function parseWhatsAppTarget(raw: string): ParsedChannelTarget {
  const match = /^([^:]+):(\+?\d{7,15})$/.exec(raw);
  if (match) {
    return {
      provider: 'whatsapp',
      conversationId: match[2]!,
      phoneNumberId: match[1]!,
      waId: match[2]!.replace(/^\+/, ''),
    };
  }

  if (/^\+?\d{7,15}$/.test(raw)) {
    return {
      provider: 'whatsapp',
      conversationId: raw,
      waId: raw.replace(/^\+/, ''),
    };
  }

  throw new Error('WhatsApp target must be E.164 or phoneNumberId:E.164');
}
