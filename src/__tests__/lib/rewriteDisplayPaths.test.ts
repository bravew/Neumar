import { describe, expect, it } from 'vitest';

import { rewriteDisplayPaths } from '@/shared/lib/rewriteDisplayPaths';

const root = '/sessions/demo';

describe('rewriteDisplayPaths', () => {
  it('shortens paths under the session root', () => {
    const text = `Saved ${root}/output/80s-video.mp4 for you.`;
    expect(rewriteDisplayPaths(text, root)).toBe(
      'Saved output/80s-video.mp4 for you.',
    );
  });

  it('leaves paths outside the session root unchanged', () => {
    const text = 'See /tmp/other/video.mp4.';
    expect(rewriteDisplayPaths(text, root)).toBe(text);
  });

  it('leaves fenced and inline code unchanged', () => {
    const text = [
      `Run \`${root}/output/a.mp4\`.`,
      '',
      '```bash',
      `cp ${root}/output/a.mp4 /tmp/a.mp4`,
      '```',
      '',
      `Then open ${root}/output/b.mp4.`,
    ].join('\n');

    const rewritten = rewriteDisplayPaths(text, root);
    expect(rewritten).toContain(`\`${root}/output/a.mp4\``);
    expect(rewritten).toContain(`cp ${root}/output/a.mp4 /tmp/a.mp4`);
    expect(rewritten).toContain('Then open output/b.mp4.');
  });

  it('leaves tilde fences and unclosed backtick fences unchanged', () => {
    const tilde = ['~~~bash', `cp ${root}/a /tmp/a`, '~~~'].join('\n');
    expect(rewriteDisplayPaths(tilde, root)).toBe(tilde);

    const unclosed = [
      `Saved ${root}/output/b.mp4.`,
      '```bash',
      `cp ${root}/a /tmp/a`,
    ].join('\n');
    const rewritten = rewriteDisplayPaths(unclosed, root);
    expect(rewritten).toContain('Saved output/b.mp4.');
    expect(rewritten).toContain(`cp ${root}/a /tmp/a`);
  });

  it('does not rewrite a longer path or a link that merely contains the root', () => {
    const outside = `Keep /archive${root}/file.txt.`;
    expect(rewriteDisplayPaths(outside, root)).toBe(outside);

    const link = `[report](https://example.com${root}/report.txt)`;
    expect(rewriteDisplayPaths(link, root)).toBe(link);
  });
});
