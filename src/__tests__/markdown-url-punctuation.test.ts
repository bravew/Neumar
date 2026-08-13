import { describe, expect, it } from 'vitest';

import {
  preprocessMarkdown,
  trimUrlPunctuation,
} from '@/shared/lib/markdown-utils';

describe('markdown URL punctuation trimming', () => {
  it('keeps sentence punctuation outside bare URL links', () => {
    expect(trimUrlPunctuation('Open https://x.com/foo.')).toBe(
      'Open [https://x.com/foo](https://x.com/foo).',
    );
    expect(trimUrlPunctuation('Open https://x.com/foo;')).toBe(
      'Open [https://x.com/foo](https://x.com/foo);',
    );
    expect(trimUrlPunctuation('Open www.example.com!')).toBe(
      'Open [www.example.com](https://www.example.com)!',
    );
    expect(trimUrlPunctuation('Open WWW.example.com!')).toBe(
      'Open [WWW.example.com](https://WWW.example.com)!',
    );
  });

  it('keeps unbalanced closing brackets outside bare URL links', () => {
    expect(trimUrlPunctuation('See (https://x.com/foo).')).toBe(
      'See ([https://x.com/foo](https://x.com/foo)).',
    );
  });

  it('trims markdown link targets without changing the label', () => {
    expect(
      trimUrlPunctuation('Read [docs](https://example.com/path.) now'),
    ).toBe('Read [docs](https://example.com/path). now');
  });

  it('does not rewrite URLs inside fenced code blocks', () => {
    expect(preprocessMarkdown('```\nhttps://x.com/foo.\n```')).toBe(
      '```\nhttps://x.com/foo.\n```',
    );
  });
});
