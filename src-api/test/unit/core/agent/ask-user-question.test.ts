import { describe, expect, it } from 'vitest';

import {
  ASK_USER_QUESTION_FENCE_LANG,
  ASK_USER_QUESTION_INSTRUCTION,
  ASK_USER_QUESTION_TOOL_NAME,
  AskUserQuestionStreamFilter,
  buildAskUserQuestionToolUse,
  tryExtractAskUserQuestion,
  validateAskUserQuestionPayload,
} from '@/core/agent/ask-user-question';
import { parsePlanningResponse } from '@/core/agent/base';
import type { AgentMessage } from '@/core/agent/types';

const VALID_PAYLOAD = {
  questions: [
    {
      question: 'What tone should the post use?',
      header: 'Tone',
      options: [
        { label: 'Witty', description: 'Light, clever.' },
        { label: 'Cozy', description: 'Warm.' },
      ],
      multiSelect: false,
      policy: { behavior: 'optional' as const, defaultOptionLabel: 'Witty' },
    },
  ],
};

function fence(body: unknown): string {
  return `\`\`\`${ASK_USER_QUESTION_FENCE_LANG}\n${JSON.stringify(body, null, 2)}\n\`\`\``;
}

describe('ASK_USER_QUESTION_INSTRUCTION', () => {
  it('embeds the fence language id and the canonical schema fields', () => {
    expect(ASK_USER_QUESTION_INSTRUCTION).toContain(
      ASK_USER_QUESTION_FENCE_LANG,
    );
    expect(ASK_USER_QUESTION_INSTRUCTION).toContain('"questions"');
    expect(ASK_USER_QUESTION_INSTRUCTION).toContain('"header"');
    expect(ASK_USER_QUESTION_INSTRUCTION).toContain('"multiSelect"');
  });
});

describe('validateAskUserQuestionPayload', () => {
  it('accepts a well-formed payload and normalizes missing description', () => {
    const ok = validateAskUserQuestionPayload({
      questions: [
        {
          question: 'q?',
          header: 'H',
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    });
    expect(ok).not.toBeNull();
    expect(ok!.questions[0].options[0]).toEqual({
      label: 'A',
      description: '',
    });
    expect(ok!.questions[0].multiSelect).toBe(false);
  });

  it('rejects empty questions, too many questions, and bad option counts', () => {
    expect(validateAskUserQuestionPayload({ questions: [] })).toBeNull();
    const tooMany = {
      questions: Array.from({ length: 5 }, () => VALID_PAYLOAD.questions[0]),
    };
    expect(validateAskUserQuestionPayload(tooMany)).toBeNull();
    const oneOption = {
      questions: [
        { ...VALID_PAYLOAD.questions[0], options: [{ label: 'only' }] },
      ],
    };
    expect(validateAskUserQuestionPayload(oneOption)).toBeNull();
  });

  it('rejects non-string labels and missing required fields', () => {
    expect(
      validateAskUserQuestionPayload({
        questions: [
          {
            question: 1,
            header: 'H',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      }),
    ).toBeNull();
    expect(
      validateAskUserQuestionPayload({
        questions: [
          { question: 'q?', header: 'H', options: [{}, { label: 'B' }] },
        ],
      }),
    ).toBeNull();
  });

  it('fails missing or invalid auto policy closed to manual', () => {
    const missing = validateAskUserQuestionPayload({
      questions: [
        {
          question: 'q?',
          header: 'H',
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    });
    const invalid = validateAskUserQuestionPayload({
      questions: [
        {
          question: 'q?',
          header: 'H',
          options: [{ label: 'A' }, { label: 'B' }],
          policy: { behavior: 'optional', defaultOptionLabel: 'Missing' },
        },
      ],
    });

    expect(missing?.questions[0].policy).toEqual({ behavior: 'manual' });
    expect(invalid?.questions[0].policy).toEqual({ behavior: 'manual' });
  });

  it.each(['approval', 'cost', 'rights', 'upload', 'destructive_edit'])(
    'keeps the %s gate manual even if optional was requested',
    (gate) => {
      const parsed = validateAskUserQuestionPayload({
        questions: [
          {
            question: 'q?',
            header: 'H',
            options: [{ label: 'A' }, { label: 'B' }],
            policy: {
              behavior: 'optional',
              gate,
              defaultOptionLabel: 'A',
            },
          },
        ],
      });

      expect(parsed?.questions[0].policy).toEqual({
        behavior: 'manual',
        gate,
      });
    },
  );

  it('accepts an explicit optional policy with a valid default', () => {
    const parsed = validateAskUserQuestionPayload({
      questions: [
        {
          question: 'q?',
          header: 'H',
          options: [{ label: 'A' }, { label: 'B' }],
          policy: { behavior: 'optional', defaultOptionLabel: 'B' },
        },
      ],
    });

    expect(parsed?.questions[0].policy).toEqual({
      behavior: 'optional',
      defaultOptionLabel: 'B',
    });
  });

  it('fails an unknown gate closed even when the optional default is valid', () => {
    const parsed = validateAskUserQuestionPayload({
      questions: [
        {
          question: 'q?',
          header: 'H',
          options: [{ label: 'A' }, { label: 'B' }],
          policy: {
            behavior: 'optional',
            gate: 'unknown',
            defaultOptionLabel: 'A',
          },
        },
      ],
    });

    expect(parsed?.questions[0].policy).toEqual({ behavior: 'manual' });
  });
});

describe('tryExtractAskUserQuestion', () => {
  it('returns the parsed payload when a complete fence is present', () => {
    const text = `here is some prose\n${fence(VALID_PAYLOAD)}\ntrailing text`;
    const parsed = tryExtractAskUserQuestion(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.questions[0].header).toBe('Tone');
  });

  it('returns null when there is no fence at all', () => {
    expect(tryExtractAskUserQuestion('plain text response')).toBeNull();
  });

  it('returns null when the fence body is not valid JSON', () => {
    const text = `\`\`\`${ASK_USER_QUESTION_FENCE_LANG}\nnot json\n\`\`\``;
    expect(tryExtractAskUserQuestion(text)).toBeNull();
  });

  it('tolerates CRLF line endings inside the fence', () => {
    const block =
      `\`\`\`${ASK_USER_QUESTION_FENCE_LANG}\r\n` +
      JSON.stringify(VALID_PAYLOAD, null, 2) +
      '\r\n```';
    expect(tryExtractAskUserQuestion(block)).not.toBeNull();
  });

  it('returns the parsed payload when a question-form block is present', () => {
    const text = `<question-form>\n${JSON.stringify(VALID_PAYLOAD)}\n</question-form>`;
    const parsed = tryExtractAskUserQuestion(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.questions[0].header).toBe('Tone');
  });

  it('returns the parsed payload when an ask-question block is present', () => {
    const text = `<ask-question>\n${JSON.stringify(VALID_PAYLOAD)}\n</ask-question>`;
    const parsed = tryExtractAskUserQuestion(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.questions[0].header).toBe('Tone');
  });

  it('does not parse question-form examples inside markdown code fences', () => {
    const text = [
      '```html',
      '<question-form>',
      JSON.stringify(VALID_PAYLOAD),
      '</question-form>',
      '```',
    ].join('\n');
    expect(tryExtractAskUserQuestion(text)).toBeNull();
  });

  it('does not parse fenced protocol examples inside markdown code fences', () => {
    const text = ['````markdown', fence(VALID_PAYLOAD), '````'].join('\n');
    expect(tryExtractAskUserQuestion(text)).toBeNull();
  });

  it('returns null when the tagged block body is malformed', () => {
    const text = '<question-form>\n{not json}\n</question-form>';
    expect(tryExtractAskUserQuestion(text)).toBeNull();
  });
});

describe('buildAskUserQuestionToolUse', () => {
  it('produces an AG-UI tool_use event with the canonical name', () => {
    const event = buildAskUserQuestionToolUse(VALID_PAYLOAD, 'fixed-id');
    expect(event).toEqual({
      type: 'tool_use',
      name: ASK_USER_QUESTION_TOOL_NAME,
      id: 'fixed-id',
      input: VALID_PAYLOAD,
    });
  });
});

describe('AskUserQuestion adapter parity', () => {
  it('normalizes Claude native, ACP, CLI, and HTTP payloads identically', () => {
    const claudeNative = validateAskUserQuestionPayload(VALID_PAYLOAD);
    const acp = tryExtractAskUserQuestion(
      `<question-form>\n${JSON.stringify(VALID_PAYLOAD)}\n</question-form>`,
    );
    const cli = tryExtractAskUserQuestion(fence(VALID_PAYLOAD));
    const http = collect(new AskUserQuestionStreamFilter(), [
      fence(VALID_PAYLOAD),
    ]).find((event) => event.type === 'tool_use')?.input;

    expect(claudeNative).not.toBeNull();
    expect(acp).toEqual(claudeNative);
    expect(cli).toEqual(claudeNative);
    expect(http).toEqual(claudeNative);
  });
});

function collect(
  filter: AskUserQuestionStreamFilter,
  chunks: string[],
): AgentMessage[] {
  const events: AgentMessage[] = [];
  for (const chunk of chunks) {
    for (const evt of filter.pushChunk(chunk)) events.push(evt);
  }
  for (const evt of filter.flush()) events.push(evt);
  return events;
}

describe('AskUserQuestionStreamFilter', () => {
  it('passes through plain text when no fence is present', () => {
    const events = collect(new AskUserQuestionStreamFilter(), [
      'hello ',
      'world',
    ]);
    expect(events.map((e) => e.content).join('')).toBe('hello world');
    expect(events.every((e) => e.type === 'text')).toBe(true);
  });

  it('emits a synthetic tool_use when a complete fence is streamed across chunks', () => {
    const block = fence(VALID_PAYLOAD);
    // Split the block in the middle to simulate a chunked stream.
    const mid = Math.floor(block.length / 2);
    const events = collect(new AskUserQuestionStreamFilter(), [
      'preamble ',
      block.slice(0, mid),
      block.slice(mid),
      ' postamble',
    ]);
    const toolUses = events.filter((e) => e.type === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0].name).toBe(ASK_USER_QUESTION_TOOL_NAME);
    // Surrounding prose should still appear as text events.
    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => e.content)
      .join('');
    expect(text).toContain('preamble');
    expect(text).toContain('postamble');
  });

  it('emits a synthetic tool_use when a complete question-form tag is streamed across chunks', () => {
    const block = `<question-form>\n${JSON.stringify(VALID_PAYLOAD)}\n</question-form>`;
    const events = collect(new AskUserQuestionStreamFilter(), [
      'preamble ',
      block.slice(0, 20),
      block.slice(20),
      ' postamble',
    ]);
    const toolUses = events.filter((e) => e.type === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0].name).toBe(ASK_USER_QUESTION_TOOL_NAME);
    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => e.content)
      .join('');
    expect(text).toContain('preamble');
    expect(text).toContain('postamble');
  });

  it('does not emit tool_use for a question-form example streamed inside a markdown code fence', () => {
    const block = [
      '```html',
      '<question-form>',
      JSON.stringify(VALID_PAYLOAD),
      '</question-form>',
      '```',
    ].join('\n');
    const events = collect(new AskUserQuestionStreamFilter(), [
      block.slice(0, 15),
      block.slice(15),
    ]);
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => e.content).join('')).toContain('<question-form>');
  });

  it('does not emit tool_use for a fenced protocol example streamed inside a markdown code fence', () => {
    const block = ['````markdown', fence(VALID_PAYLOAD), '````'].join('\n');
    const events = collect(new AskUserQuestionStreamFilter(), [
      block.slice(0, 20),
      block.slice(20),
    ]);
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => e.content).join('')).toContain(
      ASK_USER_QUESTION_FENCE_LANG,
    );
  });

  it('falls back to text when the fence body is malformed', () => {
    const malformed = `\`\`\`${ASK_USER_QUESTION_FENCE_LANG}\n{ not json }\n\`\`\``;
    const events = collect(new AskUserQuestionStreamFilter(), [malformed]);
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => e.content).join('')).toContain('not json');
  });

  it('flushes an unterminated fence as text when the stream ends', () => {
    const events = collect(new AskUserQuestionStreamFilter(), [
      `\`\`\`${ASK_USER_QUESTION_FENCE_LANG}\n{"questions":[`,
    ]);
    expect(events.every((e) => e.type === 'text')).toBe(true);
  });
});

describe('parsePlanningResponse — ask_user_question variant', () => {
  it('returns an ask_user_question payload when the planner emits the JSON variant', () => {
    const json = JSON.stringify({
      type: 'ask_user_question',
      questions: VALID_PAYLOAD.questions,
    });
    const wrapped = '```json\n' + json + '\n```';
    const result = parsePlanningResponse(wrapped);
    expect(result?.type).toBe('ask_user_question');
    if (result?.type === 'ask_user_question') {
      expect(result.payload.questions[0].header).toBe('Tone');
    }
  });

  it('falls back to direct_answer when the ask_user_question payload is malformed', () => {
    const json = JSON.stringify({
      type: 'ask_user_question',
      questions: [{ question: 'q?' }], // missing options/header
    });
    const wrapped = '```json\n' + json + '\n```';
    const result = parsePlanningResponse(wrapped);
    expect(result?.type).not.toBe('ask_user_question');
  });
});
