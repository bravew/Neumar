import { describe, expect, it } from 'vitest';

import {
  parseQuestionAnswer,
  questionTexts,
} from '@/shared/services/ag-ui/question-answers';

const asked = ['Which colour?', 'Which shape?'];

describe('questionTexts', () => {
  it('keeps only questions that carry text', () => {
    expect(
      questionTexts([
        { question: 'Which colour?' },
        { header: 'no text' },
        null,
      ]),
    ).toEqual(['Which colour?']);
  });
});

describe('parseQuestionAnswer', () => {
  it('stores the SDK answer record and derives the transcript from it', () => {
    expect(
      parseQuestionAnswer(
        { answers: { 'Which colour?': 'Blue', 'Which shape?': 'Round' } },
        asked,
      ),
    ).toEqual({
      ok: true,
      value: {
        answers: { 'Which colour?': 'Blue', 'Which shape?': 'Round' },
        text: 'Which colour? → Blue\nWhich shape? → Round',
      },
    });
  });

  it('appends a freeform note as its own line without storing it as an answer', () => {
    expect(
      parseQuestionAnswer(
        { answers: { 'Which colour?': 'Blue' }, response: 'Any shade' },
        asked,
      ),
    ).toEqual({
      ok: true,
      value: {
        answers: { 'Which colour?': 'Blue' },
        text: 'Which colour? → Blue\nAny shade',
      },
    });
  });

  it('keys the single-line answer to the first question', () => {
    expect(parseQuestionAnswer({ answer: 'Blue' }, asked)).toEqual({
      ok: true,
      value: { answers: { 'Which colour?': 'Blue' }, text: 'Blue' },
    });
  });

  it('treats a freeform-only reply as the first question answer', () => {
    expect(parseQuestionAnswer({ response: 'Blue' }, asked)).toEqual({
      ok: true,
      value: { answers: { 'Which colour?': 'Blue' }, text: 'Blue' },
    });
  });

  it('keeps a record for a question set that has no text to key by', () => {
    expect(parseQuestionAnswer({ answers: { Q: 'Blue' } }, [])).toMatchObject({
      ok: true,
      value: { answers: { Q: 'Blue' } },
    });
    expect(parseQuestionAnswer({ answer: 'Blue' }, [])).toEqual({
      ok: false,
      error: 'An answer is required',
    });
  });

  it('refuses a record that names a question that was not asked', () => {
    const result = parseQuestionAnswer(
      { answers: { 'Which size?': 'Big' } },
      asked,
    );
    expect(result.ok).toBe(false);
  });

  it('refuses an empty payload', () => {
    expect(parseQuestionAnswer({}, asked)).toEqual({
      ok: false,
      error: 'An answer is required',
    });
  });

  it('refuses blank or unknown fields', () => {
    expect(parseQuestionAnswer({ answer: '   ' }, asked).ok).toBe(false);
    expect(parseQuestionAnswer({ colour: 'Blue' }, asked).ok).toBe(false);
  });
});
