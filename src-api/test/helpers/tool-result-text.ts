import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Text of one content block. Non-text blocks contribute nothing. */
export function toolResultText(result: CallToolResult, index = 0): string {
  const block = index < 0 ? result.content.at(index) : result.content[index];
  return block && 'text' in block && typeof block.text === 'string'
    ? block.text
    : '';
}
