/**
 * Escape special characters for Telegram MarkdownV2 format.
 */
export function formatMarkdownV2(text: string): string {
  // Characters that need escaping in MarkdownV2 (outside formatting)
  return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
}

/**
 * Plain text — no escaping, for fallback sends.
 */
export function plainText(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}
