export function createMockAgentStream(
  messages: Array<{ type: string; content: string }>,
) {
  return async function* () {
    for (const msg of messages) {
      yield msg;
      await new Promise((r) => setTimeout(r, 10));
    }
  };
}

export async function collectMessages(
  stream: ReturnType<ReturnType<typeof createMockAgentStream>>,
): Promise<Array<{ type: string; content: string }>> {
  const messages: Array<{ type: string; content: string }> = [];
  for await (const msg of stream) {
    messages.push(msg);
  }
  return messages;
}

/**
 * Create a mock stream that returns a single text response and finishes.
 */
export function createMockLLMResponse(text: string) {
  return createMockAgentStream([
    { type: 'text', content: text },
    { type: 'result', content: '' },
  ]);
}

/**
 * Create a mock stream that simulates a tool call followed by its result.
 */
export function createMockToolCallStream(toolName: string, args: unknown) {
  return createMockAgentStream([
    {
      type: 'tool_use',
      content: JSON.stringify({ name: toolName, input: args }),
    },
    {
      type: 'tool_result',
      content: JSON.stringify({ output: 'done' }),
    },
    { type: 'result', content: 'Task completed.' },
  ]);
}

/**
 * Create a mock stream that simulates an error during execution.
 */
export function createMockErrorStream(errorMessage: string) {
  return createMockAgentStream([
    { type: 'text', content: 'Starting task...' },
    { type: 'error', content: errorMessage },
  ]);
}
