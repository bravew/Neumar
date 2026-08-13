import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isUsablePrintSize,
  printArtifactPdfInput,
} from '@/components/design/pdf-print';
import type { ArtifactPdfInput } from '@/shared/hooks/useDesignMode';

const invokeMock = vi.mocked(invoke);

const pdfInput: ArtifactPdfInput = {
  baseHref: 'file:///tmp/design/',
  deck: true,
  defaultFilename: 'deck.pdf',
  html: '<!doctype html><html><body><section>Deck</section></body></html>',
  title: 'Deck',
};

function enableTauriRuntime() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
}

afterEach(() => {
  delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  invokeMock.mockReset();
});

describe('printArtifactPdfInput', () => {
  it('uses the native Tauri PDF export command when available', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue(undefined);

    await printArtifactPdfInput(pdfInput);

    expect(invokeMock).toHaveBeenCalledWith('export_artifact_pdf_input', {
      input: pdfInput,
    });
  });

  it('falls back to the native Tauri print command when byte export fails', async () => {
    enableTauriRuntime();
    invokeMock
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockResolvedValueOnce(undefined);

    await printArtifactPdfInput(pdfInput);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'export_artifact_pdf_input', {
      input: pdfInput,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'print_artifact_pdf_input', {
      input: pdfInput,
    });
  });

  it('requires finite positive dimensions before treating print content as usable', () => {
    expect(isUsablePrintSize(800, 600)).toBe(true);
    expect(isUsablePrintSize(0, 600)).toBe(false);
    expect(isUsablePrintSize(800, 0)).toBe(false);
    expect(isUsablePrintSize(Number.NaN, 600)).toBe(false);
    expect(isUsablePrintSize(800, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
