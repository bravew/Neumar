/**
 * Slack Block Kit Builder
 *
 * Converts NormalizedResponse data into Slack Block Kit block arrays using
 * the native `type: "markdown"` block — Slack renders standard CommonMark
 * (tables, italic, code, lists) directly, so no manual mrkdwn conversion.
 *
 * @see https://docs.slack.dev/reference/block-kit/blocks/markdown-block/
 * @see https://docs.slack.dev/changelog/2025/02/03/block-kit-markdown/
 */

import type { ActionsBlock, KnownBlock, MarkdownBlock } from '@slack/types';

import type { ChannelButton } from '../types';
import { truncateForMarkdownBlock } from './formatter';

const MAX_BUTTON_TEXT = 75;
const MAX_BUTTON_VALUE = 2000;
const MAX_BUTTONS_PER_ACTION = 25;

/**
 * Build Block Kit blocks for a response.
 *
 * Layout:
 *   [markdown: full CommonMark text]
 *   [actions: buttons]  (optional)
 */
export function buildResponseBlocks(
  text: string,
  buttons?: ChannelButton[],
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  if (text) {
    const md: MarkdownBlock = {
      type: 'markdown',
      text: truncateForMarkdownBlock(text),
    };
    blocks.push(md);
  }

  if (buttons?.length) {
    const actions: ActionsBlock = {
      type: 'actions',
      elements: buttons.slice(0, MAX_BUTTONS_PER_ACTION).map((btn, i) => ({
        type: 'button' as const,
        text: {
          type: 'plain_text' as const,
          text:
            btn.text.length > MAX_BUTTON_TEXT
              ? btn.text.slice(0, MAX_BUTTON_TEXT - 1) + '…'
              : btn.text,
          emoji: true,
        },
        action_id: `neuma:button:${i}`,
        value: btn.data.slice(0, MAX_BUTTON_VALUE),
      })),
    };
    blocks.push(actions);
  }

  return blocks;
}
