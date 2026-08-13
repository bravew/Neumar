/**
 * Text sanitization utilities for agent profile and soul content.
 *
 * Strips XML-like tags that could interfere with prompt parsing,
 * removes delimiter sequences, and collapses excessive whitespace.
 */

/** Sanitize profile/soul text by removing dangerous XML tags and delimiter sequences. */
export function sanitizeProfileText(text: string): string {
  return text
    .replace(
      /<\/?(?:user_preferences|agent_profile|agent_soul|system|instructions|prompt|assistant|tool|tool_use|tool_result|human|claude|thinking|artifact|function_calls|result|antml)[^>]*>/gi,
      '',
    )
    .replace(/^[-=*]{4,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
