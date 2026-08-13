import { describe, expect, it } from 'vitest';

import {
  normalizeLarkCardAction,
  normalizeLarkMessageEvent,
  normalizeLarkReactionEvent,
} from '@/shared/channels/lark/message-adapter';

describe('Lark message adapter', () => {
  it('normalizes text messages and mention display names', () => {
    const normalized = normalizeLarkMessageEvent(
      {
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: {
            message_id: 'om_1',
            chat_id: 'oc_chat',
            message_type: 'text',
            content: JSON.stringify({ text: '/status @_user_1' }),
            mentions: [{ key: '@_user_1', name: 'Ada' }],
          },
        },
      },
      'cfg1',
    );

    expect(normalized).toMatchObject({
      platform: 'lark',
      configId: 'cfg1',
      messageId: 'om_1',
      conversationId: 'oc_chat',
      userId: 'ou_user',
      text: '/status @Ada',
      isCommand: true,
      commandName: 'status',
    });
  });

  it('extracts post text and resource placeholders', () => {
    const normalized = normalizeLarkMessageEvent(
      {
        sender: { sender_id: { user_id: 'u1' } },
        message: {
          message_id: 'om_2',
          chat_id: 'oc_chat',
          message_type: 'post',
          content: JSON.stringify({
            title: 'Launch',
            content: [
              [
                { tag: 'text', text: 'Ship ' },
                { tag: 'at', user_name: 'Grace' },
                { tag: 'img', image_key: 'img_1' },
              ],
            ],
          }),
        },
      },
      'cfg1',
    );

    expect(normalized?.text).toContain('Launch');
    expect(normalized?.text).toContain('@Grace');
    expect(normalized?.attachments).toEqual([
      'lark-resource://om_2/image/img_1',
    ]);
    expect(normalized?.metadata?.larkResources).toEqual([
      { type: 'image', fileKey: 'img_1' },
    ]);
  });

  it('normalizes reaction and card action events', () => {
    expect(
      normalizeLarkReactionEvent({
        configId: 'cfg1',
        action: 'added',
        conversationId: 'oc_chat',
        event: {
          message_id: 'om_3',
          reaction_type: { emoji_type: 'Thumbsup' },
          user_id: { open_id: 'ou_user' },
        },
      }),
    ).toMatchObject({
      text: 'reaction_added: Thumbsup',
      conversationId: 'oc_chat',
      userId: 'ou_user',
    });

    expect(
      normalizeLarkCardAction(
        {
          open_id: 'ou_user',
          open_message_id: 'om_4',
          action: {
            option: 'high',
            value: {
              kind: 'select',
              formId: 'form1',
              customId: 'neuma:select:0:form1',
            },
          },
        },
        'cfg1',
      ),
    ).toMatchObject({
      text: 'high',
      messageId: 'om_4',
      userId: 'ou_user',
      metadata: { kind: 'card_action', selected: 'high' },
    });
  });
});
