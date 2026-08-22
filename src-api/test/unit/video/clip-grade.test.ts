import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { analyzeClipGradeImage } from '@/shared/video/analysis/clip-grade';

describe('clip grade analysis', () => {
  it('measures a frame and keeps proposed corrections bounded', async () => {
    const frame = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 40, g: 60, b: 90 },
      },
    })
      .png()
      .toBuffer();

    const analysis = await analyzeClipGradeImage(
      frame.toString('base64'),
      'warmer',
    );

    expect(analysis.schema).toBe('neuma.video.clip-grade-analysis.v1');
    expect(analysis.measurements.luminance).toBeGreaterThan(0);
    expect(analysis.correction.brightness).toBeGreaterThanOrEqual(-0.25);
    expect(analysis.correction.brightness).toBeLessThanOrEqual(0.25);
    expect(analysis.correction.contrast).toBeGreaterThanOrEqual(0.85);
    expect(analysis.correction.contrast).toBeLessThanOrEqual(1.15);
    expect(analysis.correction.temperature).toBeGreaterThan(0);
  });
});
