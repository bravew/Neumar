import { parseChannelTarget } from '../_shared/targets';

export interface LarkSendTarget {
  receiveId: string;
  receiveIdType: 'chat_id' | 'open_id' | 'user_id';
  direct: boolean;
}

export function parseLarkSendTarget(raw: string): LarkSendTarget {
  const target = parseChannelTarget('lark', raw);
  return {
    receiveId: target.conversationId,
    receiveIdType:
      target.receiveIdType ?? inferReceiveIdType(target.conversationId),
    direct: /^(lark:|feishu:)?dm:/i.test(raw.trim()),
  };
}

function inferReceiveIdType(id: string): 'chat_id' | 'open_id' | 'user_id' {
  if (id.startsWith('oc_')) return 'chat_id';
  if (id.startsWith('ou_')) return 'open_id';
  return 'user_id';
}
