import { describe, expect, it } from 'vitest';

import { isConversationalPrompt } from '@/shared/hooks/agent-utils';

// Mirrors src-api/test/unit/core/agent/base.test.ts — keep in sync.

describe('isConversationalPrompt (frontend)', () => {
  // ── English ──────────────────────────────────────────────────────────────

  describe('English greetings', () => {
    it.each([
      'hi',
      'hello',
      'hey',
      'thanks',
      'thank you',
      'ok',
      'okay',
      'sure',
      'great',
      'got it',
      'yep',
      'yup',
    ])('returns true for "%s"', (g) =>
      expect(isConversationalPrompt(g)).toBe(true),
    );

    it('allows trailing punctuation', () => {
      expect(isConversationalPrompt('hello!')).toBe(true);
      expect(isConversationalPrompt('thanks.')).toBe(true);
    });
  });

  describe('English identity questions', () => {
    it.each([
      'who are you',
      'what are you',
      'what can you do',
      'tell me about yourself',
      'what is your name',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('English knowledge Q&A', () => {
    it.each([
      'how does React work?',
      'what is TypeScript?',
      'why is the sky blue?',
      'explain recursion',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('English tasks → false', () => {
    it.each([
      'write a Python script to parse JSON',
      'create a new React component',
      'build a REST API',
      'fix the bug in my code',
      'delete the temp folder',
      'install the dependencies',
      'commit and push the changes',
    ])('returns false for "%s"', (t) =>
      expect(isConversationalPrompt(t)).toBe(false),
    );
  });

  describe('context-line stripping', () => {
    it('strips [workspace] lines before checking', () => {
      expect(isConversationalPrompt('[workspace: /home/user]\nhello')).toBe(
        true,
      );
    });

    it('returns true for empty prompt after stripping', () => {
      expect(isConversationalPrompt('[context]\n[more]')).toBe(true);
    });
  });

  // ── Chinese ──────────────────────────────────────────────────────────────

  describe('Chinese greetings', () => {
    it.each([
      '你好',
      '您好',
      '嗨',
      '谢谢',
      '好的',
      '对的',
      '明白了',
      '早上好',
      '晚安',
    ])('returns true for "%s"', (g) =>
      expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('Chinese identity questions', () => {
    it.each(['你是谁', '你能做什么', '你叫什么名字', '你有什么功能'])(
      'returns true for "%s"',
      (q) => expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('Chinese knowledge questions', () => {
    it.each(['这是什么？', '为什么天是蓝的？', '怎么工作？'])(
      'returns true for "%s"',
      (q) => expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('Chinese tasks → false', () => {
    it.each([
      '删除文件',
      '写一段Python代码',
      '创建一个新组件',
      '你能帮我写代码吗？',
    ])('returns false for "%s"', (t) =>
      expect(isConversationalPrompt(t)).toBe(false),
    );
  });

  // ── Japanese / Korean ────────────────────────────────────────────────────

  describe('Japanese and Korean greetings', () => {
    it.each([
      'こんにちは',
      'ありがとう',
      'はい',
      '안녕하세요',
      '감사합니다',
      '네',
    ])('returns true for "%s"', (g) =>
      expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  // ── Spanish ──────────────────────────────────────────────────────────────

  describe('Spanish greetings', () => {
    it.each(['hola', 'gracias', 'buenas', '¡hola!'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('Spanish identity questions', () => {
    it.each(['quién eres', 'qué eres', 'qué puedes hacer', 'cómo te llamas'])(
      'returns true for "%s"',
      (q) => expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('Spanish knowledge questions', () => {
    it.each([
      '¿cómo funciona React?',
      'qué es TypeScript?',
      'por qué el cielo es azul?',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  // ── French ───────────────────────────────────────────────────────────────

  describe('French greetings', () => {
    it.each(['bonjour', 'salut', 'merci', 'bonsoir'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('French knowledge questions', () => {
    it.each([
      'comment fonctionne React?',
      'pourquoi le ciel est bleu?',
      'où se trouve Paris?',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  // ── Portuguese ───────────────────────────────────────────────────────────

  describe('Portuguese greetings', () => {
    it.each(['olá', 'oi', 'obrigado', 'obrigada', 'tudo bem'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('Portuguese knowledge questions', () => {
    it.each([
      'como funciona o React?',
      'o que é TypeScript?',
      'por que o céu é azul?',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  // ── Hindi ────────────────────────────────────────────────────────────────

  describe('Hindi greetings', () => {
    it.each(['नमस्ते', 'नमस्कार', 'धन्यवाद', 'शुक्रिया', 'हाँ', 'ठीक है'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('Hindi identity questions', () => {
    it.each(['तुम कौन हो', 'आप कौन हैं', 'आपका नाम क्या है'])(
      'returns true for "%s"',
      (q) => expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns true for empty string', () => {
      expect(isConversationalPrompt('')).toBe(true);
    });

    it('returns false for a long task (> 300 chars starting with question word)', () => {
      expect(isConversationalPrompt('what '.repeat(61))).toBe(false);
    });

    it('returns false for Han message > 30 chars with question mark', () => {
      expect(isConversationalPrompt('这'.repeat(31) + '？')).toBe(false);
    });
  });
});
