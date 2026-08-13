import { describe, expect, it } from 'vitest';

import {
  extractStructuredDirectAnswer,
  isStructuredPlanEnvelope,
  parseStructuredEnvelope,
} from '@/shared/utils/structured-envelope';

describe('structured envelope parser', () => {
  it('extracts direct answers from fenced json envelopes', () => {
    const content = [
      '```json',
      '{',
      '  "type": "direct_answer",',
      '  "answer": "Here is the short answer."',
      '}',
      '```',
    ].join('\n');

    expect(extractStructuredDirectAnswer(content)).toBe(
      'Here is the short answer.',
    );
  });

  it('detects bare and fenced plan envelopes', () => {
    const bare = '{"type":"plan","goal":"Ship","steps":[]}';
    const fenced = ['```json', bare, '```'].join('\n');

    expect(isStructuredPlanEnvelope(bare)).toBe(true);
    expect(parseStructuredEnvelope(fenced)).toMatchObject({
      type: 'plan',
      value: { goal: 'Ship' },
    });
  });

  it('ignores non-envelope markdown code fences', () => {
    expect(
      parseStructuredEnvelope(['```ts', 'const x = 1;', '```'].join('\n')),
    ).toBeNull();
  });
});
