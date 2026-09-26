// Live Claude model discovery through the Claude Agent SDK. The CLI has no
// `models` subcommand; its model catalog is only exposed over the SDK control
// protocol (`Query.supportedModels()`), answered during initialization before
// any prompt is sent — so no turn runs and nothing is billed.

import os from 'node:os';

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { parseClaudeSupportedModels } from './models.js';
import type { ModelOption } from './types.js';

const CLAUDE_MODELS_TIMEOUT_MS = 10_000;

export async function fetchClaudeSupportedModels(
  resolvedBin: string,
): Promise<ModelOption[] | null> {
  // The prompt stream stays open (and empty) until the probe finishes, so the
  // CLI initializes and answers control requests without starting a turn.
  let releasePrompt!: () => void;
  const promptHeld = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await promptHeld;
        return { done: true, value: undefined };
      },
    }),
  };

  const probe = query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: resolvedBin,
      // Same settings tier as agent runs, so user-level model restrictions and
      // provider env apply; the home cwd keeps project settings out.
      settingSources: ['user'],
      cwd: os.homedir(),
    },
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `supportedModels() timed out after ${CLAUDE_MODELS_TIMEOUT_MS}ms`,
          ),
        ),
      CLAUDE_MODELS_TIMEOUT_MS,
    );
  });
  try {
    const models = await Promise.race([probe.supportedModels(), timeout]);
    return parseClaudeSupportedModels(models);
  } finally {
    clearTimeout(timer);
    releasePrompt();
    probe.close();
  }
}
