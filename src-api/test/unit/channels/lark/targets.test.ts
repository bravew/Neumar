import { describe, expect, it } from 'vitest';

import { parseLarkSendTarget } from '@/shared/channels/lark/targets';

describe('Lark targets', () => {
  it('detects chat, open id, user id, and explicit DM targets', () => {
    expect(parseLarkSendTarget('oc_chat')).toEqual({
      receiveId: 'oc_chat',
      receiveIdType: 'chat_id',
      direct: false,
    });
    expect(parseLarkSendTarget('ou_user')).toEqual({
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
      direct: false,
    });
    expect(parseLarkSendTarget('user:abc123')).toEqual({
      receiveId: 'abc123',
      receiveIdType: 'user_id',
      direct: false,
    });
    expect(parseLarkSendTarget('feishu:dm:ou_user')).toEqual({
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
      direct: true,
    });
  });
});
