/**
 * Telegram Streaming Handler
 *
 * Edit-in-place streaming: send initial message, then editMessageText
 * with accumulated text at debounced intervals.
 */

import type { Api, RawApi } from 'grammy';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('TelegramStreaming');

const EDIT_DEBOUNCE_MS = 500;

export class TelegramStreamingSession {
  private messageId: number | null = null;
  private chatId: string | number;
  private api: Api<RawApi>;
  private accumulated = '';
  private lastEditTime = 0;
  private editTimer: NodeJS.Timeout | null = null;

  constructor(api: Api<RawApi>, chatId: string | number) {
    this.api = api;
    this.chatId = chatId;
  }

  async appendAndMaybeEdit(chunk: string): Promise<void> {
    this.accumulated += chunk;

    if (!this.messageId) {
      // Send initial message
      try {
        const result = await this.api.sendMessage(
          this.chatId,
          this.accumulated,
        );
        this.messageId = result.message_id;
        this.lastEditTime = Date.now();
      } catch (err) {
        logger.error('Failed to send initial streaming message', err);
      }
      return;
    }

    // Debounce edits
    const now = Date.now();
    if (now - this.lastEditTime < EDIT_DEBOUNCE_MS) {
      // Schedule a deferred edit
      if (this.editTimer) clearTimeout(this.editTimer);
      this.editTimer = setTimeout(() => this.doEdit(), EDIT_DEBOUNCE_MS);
      return;
    }

    await this.doEdit();
  }

  async finalize(): Promise<number | null> {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    if (this.messageId && this.accumulated.length > 0) {
      await this.doEdit();
    } else if (!this.messageId && this.accumulated.length > 0) {
      try {
        const result = await this.api.sendMessage(
          this.chatId,
          this.accumulated,
        );
        this.messageId = result.message_id;
      } catch (err) {
        logger.error('Failed to send final streaming message', err);
      }
    }

    return this.messageId;
  }

  private async doEdit(): Promise<void> {
    if (!this.messageId) return;
    try {
      await this.api.editMessageText(
        this.chatId,
        this.messageId,
        this.accumulated,
      );
      this.lastEditTime = Date.now();
    } catch (err) {
      // "message is not modified" is expected during rapid edits
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('not modified')) {
        logger.warn('Edit message failed', msg);
      }
    }
  }

  get currentMessageId(): number | null {
    return this.messageId;
  }
}
