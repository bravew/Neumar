import type { Locator, Page } from '@playwright/test';

/**
 * Page Object for the TaskDetailV2 page (/task-v2/:taskId).
 *
 * Uses resilient locators: role, text, and structure-based selectors.
 */
export class TaskV2Page {
  /** The chat input for follow-up messages */
  readonly chatInput: Locator;
  /** Stop/abort button for running tasks */
  readonly stopButton: Locator;

  constructor(private page: Page) {
    this.chatInput = page.getByPlaceholder(/type a message/i);
    this.stopButton = page.getByRole('button', { name: /stop/i });
  }

  async goto(taskId: string) {
    await this.page.goto(`/task-v2/${taskId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async sendMessage(text: string) {
    await this.chatInput.fill(text);
    await this.chatInput.press('Enter');
  }

  /** Wait for at least one assistant message to appear */
  async waitForAssistantMessage() {
    // Assistant messages typically have role="assistant" or a distinguishable class
    await this.page
      .locator('[data-role="assistant"], .assistant-message')
      .first()
      .waitFor({ timeout: 15_000 });
  }

  async stop() {
    await this.stopButton.click();
  }
}
