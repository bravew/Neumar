import { describe, expect, it } from 'vitest';

import { classifyExportError } from '@/shared/utils/export-error';

function apiError(
  message: string,
  data: Record<string, unknown>,
): Error & { status: number; data: Record<string, unknown> } {
  return Object.assign(new Error(message), { status: 422, data });
}

describe('classifyExportError', () => {
  it('prefers a structured code from the API payload', () => {
    const err = apiError('PDF export requires a renderer', {
      code: 'renderer_unavailable',
      dependency: 'playwright',
    });
    const classified = classifyExportError(err);
    expect(classified.code).toBe('renderer_unavailable');
    expect(classified.dependency).toBe('playwright');
  });

  it('ignores structured codes outside the shared vocabulary', () => {
    const err = apiError('Export blocked by P0 DesignMode lint findings', {
      code: 'SOME_UPSTREAM_CODE',
    });
    expect(classifyExportError(err).code).toBe('export_blocked_by_lint');
  });

  it('classifies a missing dependency from the 422 payload', () => {
    const err = apiError(
      'DOCX export requires a document converter such as pandoc; no converter is currently configured.',
      { dependency: 'pandoc', format: 'docx' },
    );
    const classified = classifyExportError(err);
    expect(classified.code).toBe('dependency_missing');
    expect(classified.dependency).toBe('pandoc');
    expect(classified.retryable).toBe(false);
  });

  it('classifies attribution-blocked image exports separately', () => {
    const err = apiError(
      'Image PNG export is blocked because attached assets require attribution',
      {
        dependency: 'asset attribution',
        source: 'asset_materializations',
      },
    );
    const classified = classifyExportError(err);
    expect(classified.code).toBe('attribution_blocked');
    expect(classified.source).toBe('asset_materializations');
  });

  it('classifies invalid slides.json as invalid input', () => {
    const err = apiError(
      'PPTX export requires valid artifacts/slides.json: Unexpected token',
      { dependency: 'slides.json', source: 'artifacts/slides.json' },
    );
    expect(classifyExportError(err).code).toBe('invalid_input');
  });

  it('classifies the P0 lint block from its message', () => {
    const classified = classifyExportError(
      new Error('Export blocked by P0 DesignMode lint findings'),
    );
    expect(classified.code).toBe('export_blocked_by_lint');
    expect(classified.retryable).toBe(false);
  });

  it('classifies preview snapshot failures into distinct retryable codes', () => {
    expect(
      classifyExportError(new Error('Preview snapshot timed out.')),
    ).toMatchObject({ code: 'snapshot_timeout', retryable: true });
    expect(
      classifyExportError(new Error('Preview frame is not ready.')),
    ).toMatchObject({ code: 'renderer_unavailable', retryable: true });
    expect(
      classifyExportError(new Error('Preview snapshot image failed.')),
    ).toMatchObject({ code: 'capture_failed', retryable: true });
  });

  it('groups WebCodecs encoder failures under one code', () => {
    for (const message of [
      'Encoder emitted non-monotonic write: expected 1024, got 512',
      'Encoder did not produce an output buffer',
      'Frame 42 did not render',
    ]) {
      expect(classifyExportError(new Error(message)).code).toBe(
        'webcodecs_encoder',
      );
    }
  });

  it('classifies chunk upload and fetch failures as network', () => {
    expect(classifyExportError(new Error('chunk POST 502'))).toMatchObject({
      code: 'network',
      retryable: true,
    });
    expect(classifyExportError(new TypeError('Failed to fetch')).code).toBe(
      'network',
    );
  });

  it('classifies render host input validation as invalid input', () => {
    expect(
      classifyExportError(new Error('Render host input must be an object'))
        .code,
    ).toBe('invalid_input');
    expect(
      classifyExportError(
        new Error('Render host input is missing required timeline fields'),
      ).code,
    ).toBe('invalid_input');
  });

  it('falls back to unknown while preserving the message', () => {
    const classified = classifyExportError(
      new Error('export request failed (500)'),
    );
    expect(classified.code).toBe('unknown');
    expect(classified.message).toBe('export request failed (500)');
    expect(classified.retryable).toBe(false);
  });

  it('handles non-Error throwables', () => {
    expect(classifyExportError('nope')).toMatchObject({
      code: 'unknown',
      message: 'nope',
    });
    expect(classifyExportError(undefined).code).toBe('unknown');
  });
});
