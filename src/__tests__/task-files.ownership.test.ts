import { describe, expect, it } from 'vitest';

import { isTaskOwnedFilePath } from '@/shared/lib/task-files';

describe('isTaskOwnedFilePath', () => {
  it('rejects files stored under a different task session', () => {
    expect(
      isTaskOwnedFilePath(
        '/Users/me/.neumar/sessions/session-task-old/output/old.mp4',
        'task-current',
      ),
    ).toBe(false);
  });

  it('keeps current-session and non-session paths', () => {
    expect(
      isTaskOwnedFilePath(
        '/Users/me/.neumar/sessions/session-task-current/output/final.mp4',
        'task-current',
      ),
    ).toBe(true);
    expect(
      isTaskOwnedFilePath('https://example.com/reference', 'task-current'),
    ).toBe(true);
  });
});
