import { describe, expect, it } from 'vitest';

import {
  getWorkspaceInstruction,
  isConversationalPrompt,
} from '@/core/agent/base';

describe('getWorkspaceInstruction', () => {
  it('describes OS isolation for the default execution policy', () => {
    const instruction = getWorkspaceInstruction('/tmp/project');

    expect(instruction).toContain('isolation enforced at the OS level');
    expect(instruction).toContain('BLOCKED by the sandbox');
  });

  it('describes the typed Video boundary for host-native execution', () => {
    const instruction = getWorkspaceInstruction(
      '/tmp/project',
      undefined,
      '/tmp/workspace',
      false,
      'host-native',
    );

    expect(instruction).toContain('host-native execution');
    expect(instruction).toContain('approved, origin-aware Video tools');
    expect(instruction).toContain('No general shell');
    expect(instruction).not.toContain('BLOCKED by the sandbox');
  });
});

describe('isConversationalPrompt', () => {
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
      expect(isConversationalPrompt('ok?')).toBe(true);
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
      'describe what a closure is',
      'what is machine learning?',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('English tasks → false', () => {
    it.each([
      'write a Python script to parse JSON',
      'create a new React component',
      'build a REST API',
      'implement a binary search tree',
      'fix the bug in my code',
      'delete the temp folder',
      'run the tests',
      'install the dependencies',
      'refactor this function',
      'commit and push the changes',
    ])('returns false for "%s"', (t) =>
      expect(isConversationalPrompt(t)).toBe(false),
    );
  });

  describe('English context-line stripping', () => {
    it('strips [workspace] prefix lines before checking', () => {
      const withContext = '[workspace: /home/user]\nhello';
      expect(isConversationalPrompt(withContext)).toBe(true);
    });

    it('returns false for a task even with context lines', () => {
      const withContext = '[profile: dev]\nwrite a sorting algorithm';
      expect(isConversationalPrompt(withContext)).toBe(false);
    });

    it('returns true for empty prompt after stripping', () => {
      expect(isConversationalPrompt('[context only]\n[more context]')).toBe(
        true,
      );
    });
  });

  // ── Chinese (Han script) ─────────────────────────────────────────────────

  describe('Chinese greetings', () => {
    it.each([
      '你好',
      '您好',
      '嗨',
      '谢谢',
      '谢谢你',
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
    it.each([
      '你是谁',
      '你能做什么',
      '你叫什么名字',
      '介绍一下你自己',
      '你有什么功能',
      '你会什么',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('Chinese knowledge questions (with question mark, no task verbs)', () => {
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
      '安装依赖',
      '你能帮我写代码吗？', // question mark but has task verb 写
      '生成一个报告',
    ])('returns false for "%s"', (t) =>
      expect(isConversationalPrompt(t)).toBe(false),
    );
  });

  // ── Japanese / Korean (East Asian scripts → same branch as Chinese) ────────

  describe('Japanese greetings', () => {
    it.each(['こんにちは', 'ありがとう', 'はい', 'こんばんは', 'おはよう'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('Korean greetings', () => {
    it.each(['안녕하세요', '감사합니다', '네'])('returns true for "%s"', (g) =>
      expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  // ── Spanish (Latin script) ───────────────────────────────────────────────

  describe('Spanish greetings', () => {
    it.each(['hola', 'gracias', 'oye', 'buenas', 'hola!', '¡hola!'])(
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

  describe('Spanish tasks → false', () => {
    it('returns false for a task with English task keyword (script)', () => {
      expect(isConversationalPrompt('crea un script de Python')).toBe(false);
    });
  });

  // ── French (Latin script) ────────────────────────────────────────────────

  describe('French greetings', () => {
    it.each(['bonjour', 'salut', 'merci', 'bonsoir', 'bonjour!'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('French identity questions', () => {
    it.each(['qui es-tu', 'que peux-tu faire', "comment tu t'appelles"])(
      'returns true for "%s"',
      (q) => expect(isConversationalPrompt(q)).toBe(true),
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

  // ── Portuguese (Latin script) ────────────────────────────────────────────

  describe('Portuguese greetings', () => {
    it.each(['olá', 'oi', 'obrigado', 'obrigada', 'tudo bem'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('Portuguese identity questions', () => {
    it.each([
      'quem é você',
      'o que você é',
      'o que você faz',
      'qual é o seu nome',
    ])('returns true for "%s"', (q) =>
      expect(isConversationalPrompt(q)).toBe(true),
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

  // ── Hindi (Devanagari script) ────────────────────────────────────────────

  describe('Hindi greetings', () => {
    it.each(['नमस्ते', 'नमस्कार', 'धन्यवाद', 'शुक्रिया', 'हाँ', 'ठीक है', 'हेलो'])(
      'returns true for "%s"',
      (g) => expect(isConversationalPrompt(g)).toBe(true),
    );
  });

  describe('Hindi identity questions', () => {
    it.each(['तुम कौन हो', 'आप कौन हैं', 'आपका नाम क्या है', 'अपने बारे में बताओ'])(
      'returns true for "%s"',
      (q) => expect(isConversationalPrompt(q)).toBe(true),
    );
  });

  describe('Hindi short questions with question mark', () => {
    it('returns true for short question ending with ?', () => {
      expect(isConversationalPrompt('यह क्या है?')).toBe(true);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns true for empty string', () => {
      expect(isConversationalPrompt('')).toBe(true);
    });

    it('returns true for whitespace-only input', () => {
      expect(isConversationalPrompt('   ')).toBe(true);
    });

    it('returns false for long English task (> 300 chars)', () => {
      const longTask = 'what '.repeat(61); // 305 chars, starts with question word
      expect(isConversationalPrompt(longTask)).toBe(false);
    });

    it('returns false for Han message longer than 30 chars with question mark', () => {
      const longZh = '这'.repeat(31) + '？';
      expect(isConversationalPrompt(longZh)).toBe(false);
    });
  });

  // ── Declarative statements (preferences, facts, memory-worthy) ──────────

  describe('English declarative statements', () => {
    it.each([
      'I prefer dark mode and use Vim keybindings',
      'I like TypeScript over JavaScript',
      'I always use pnpm instead of npm',
      'I am a backend engineer',
      "I'm a data scientist",
      'My name is Alice',
      'My team uses PostgreSQL',
      'Remember that our region is us-east-1',
      "Don't forget the API rate limit is 100/min",
    ])('returns true for "%s"', (s) =>
      expect(isConversationalPrompt(s)).toBe(true),
    );

    it('returns false for declarative + task keyword', () => {
      // "I prefer" matches declarative, but "create" is a task keyword → not conversational
      expect(isConversationalPrompt('I prefer you create a new file')).toBe(
        false,
      );
    });

    it('returns false for long declarative (>200 chars)', () => {
      const long = 'I prefer ' + 'a'.repeat(200);
      expect(isConversationalPrompt(long)).toBe(false);
    });
  });

  describe('Chinese declarative statements', () => {
    it.each([
      '我喜欢暗色主题',
      '我是后端工程师',
      '我的名字是张三',
      '记住我们用的是PostgreSQL',
      '别忘了我们的区域是us-east-1',
    ])('returns true for "%s"', (s) =>
      expect(isConversationalPrompt(s)).toBe(true),
    );

    it('returns false for declarative + task verb', () => {
      expect(isConversationalPrompt('我喜欢你写的代码')).toBe(false);
    });
  });

  describe('Hindi declarative statements', () => {
    it.each([
      'मुझे पसंद है डार्क मोड',
      'मैं हूं बैकएंड इंजीनियर',
      'मेरा नाम राहुल है',
      'याद रखो कि हम PostgreSQL इस्तेमाल करते हैं',
    ])('returns true for "%s"', (s) =>
      expect(isConversationalPrompt(s)).toBe(true),
    );

    it('returns false for declarative + task verb', () => {
      // "मुझे ज़रूरत है कोड लिखो" = "I need [you to] write code"
      expect(isConversationalPrompt('मुझे ज़रूरत है कोड लिखो')).toBe(false);
    });
  });

  describe('Spanish/French/Portuguese declarative statements', () => {
    it.each([
      'prefiero el modo oscuro',
      'me llamo Carlos',
      'je préfère le mode sombre',
      'je suis développeur backend',
      'eu prefiro TypeScript',
      'meu nome é João',
    ])('returns true for "%s"', (s) =>
      expect(isConversationalPrompt(s)).toBe(true),
    );
  });
});
