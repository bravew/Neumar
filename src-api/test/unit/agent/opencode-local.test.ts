import { describe, expect, it } from 'vitest';

import { buildOpenCodeStdinInvocation } from '@/extensions/agent/opencode-local';

describe('OpenCode local adapter', () => {
  it('delivers the prompt through stdin in non-interactive mode', () => {
    const invocation = buildOpenCodeStdinInvocation('remember this context');

    expect(invocation.args).toEqual(['--non-interactive']);
    expect(invocation.stdin).toContain('neuma:ask_user_question');
    expect(invocation.stdin).toMatch(/\n\nremember this context$/);
  });
});
