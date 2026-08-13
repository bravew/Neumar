import { describe, expect, it } from 'vitest';

import { summarizeFileOperations } from '@/shared/utils/file-operation-summary';

describe('summarizeFileOperations', () => {
  it('counts a written then edited file once as edited', () => {
    const summary = summarizeFileOperations([
      { name: 'Write', args: { file_path: 'src/App.tsx' } },
      { name: 'Edit', args: { file_path: 'src/App.tsx' } },
    ]);

    expect(summary.producedFiles).toEqual([
      { path: 'src/App.tsx', operation: 'edited' },
    ]);
    expect(summary.totals).toMatchObject({ write: 1, edit: 1 });
  });

  it('deduplicates repeated edits while retaining raw totals', () => {
    const summary = summarizeFileOperations([
      { name: 'Edit', args: { path: 'src/App.tsx' } },
      { name: 'Edit', args: { path: 'src/App.tsx' } },
    ]);

    expect(summary.producedFiles).toHaveLength(1);
    expect(summary.totals.edit).toBe(2);
  });

  it('does not count a read-only file as produced', () => {
    const summary = summarizeFileOperations([
      { name: 'Read', args: { file_path: 'README.md' } },
    ]);

    expect(summary.producedFiles).toEqual([]);
    expect(summary.totals.read).toBe(1);
  });

  it('moves a produced identity to the rename destination', () => {
    const summary = summarizeFileOperations([
      { name: 'Write', args: { file_path: 'draft.md' } },
      { name: 'Rename', args: { old_path: 'draft.md', new_path: 'final.md' } },
    ]);

    expect(summary.producedFiles).toEqual([
      { path: 'final.md', operation: 'renamed' },
    ]);
    expect(summary.totals.rename).toBe(1);
  });

  it('removes a deleted file from the produced set', () => {
    const summary = summarizeFileOperations([
      { name: 'Write', args: { file_path: 'temporary.md' } },
      { name: 'Delete', args: { path: 'temporary.md' } },
    ]);

    expect(summary.producedFiles).toEqual([]);
    expect(summary.totals.delete).toBe(1);
  });
});
