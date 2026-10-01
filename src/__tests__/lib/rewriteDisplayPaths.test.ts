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
});
