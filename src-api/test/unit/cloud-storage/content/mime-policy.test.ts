import { describe, expect, it } from 'vitest';

import { evaluateMimeForMaterialization } from '@/shared/integrations/cloud-storage/content';

describe('cloud storage mime policy', () => {
  it('allows text files and small PDFs', () => {
    expect(
      evaluateMimeForMaterialization({ mimeType: 'text/markdown' }),
    ).toEqual({ action: 'allow' });
    expect(
      evaluateMimeForMaterialization({
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).toEqual({ action: 'allow' });
  });

  it('skips large PDFs and executables', () => {
    expect(
      evaluateMimeForMaterialization({
        mimeType: 'application/pdf',
        sizeBytes: 26 * 1024 * 1024,
      }),
    ).toEqual({ action: 'skip', reason: 'file_too_large' });
    expect(
      evaluateMimeForMaterialization({
        mimeType: 'application/x-msdownload',
      }),
    ).toEqual({ action: 'skip', reason: 'mime_skipped' });
  });
});
