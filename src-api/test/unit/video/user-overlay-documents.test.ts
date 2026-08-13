import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteUserOverlayDocument,
  listUserOverlayDocuments,
  saveUserOverlayDocument,
  SaveUserOverlayDocumentInputSchema,
  USER_OVERLAY_DOCUMENT_FILE,
  USER_OVERLAY_DOCUMENT_SCHEMA_ID,
} from '@/shared/video/overlays/user-documents';

const VALID_DOCUMENT_HTML = `
<html>
  <head>
    <style>
      @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      .badge { animation: fade 1000ms linear both; }
    </style>
  </head>
  <body>
    <div class="badge">Launch</div>
    <script>window.__overlayReady = true;</script>
  </body>
</html>`;

describe('user overlay documents', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-overlay-docs-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('compiles, saves, lists, and deletes an explicitly approved document', async () => {
    const saved = await saveUserOverlayDocument({
      name: 'Reference badge',
      html: VALID_DOCUMENT_HTML,
      controls: [
        {
          id: 'label',
          type: 'text',
          label: 'Label',
          defaultValue: 'Launch',
        },
      ],
      tags: ['badge', 'badge', 'video-to-template'],
      provenance: { kind: 'video-to-template', sourceId: 'clip-1' },
      userConfirmed: true,
    });

    expect(saved).toMatchObject({
      id: expect.stringMatching(/^doc:/),
      name: 'Reference badge',
      tags: ['badge', 'video-to-template'],
      provenance: {
        kind: 'video-to-template',
        sourceId: 'clip-1',
        createdAt: expect.any(String),
      },
    });
    expect(saved.compiledHtml).toContain('Content-Security-Policy');
    expect(saved.compiledHtml).toContain('__neumaOverlaySeek');

    expect(await listUserOverlayDocuments()).toEqual([saved]);
    const raw = JSON.parse(
      await fs.readFile(path.join(workDir, USER_OVERLAY_DOCUMENT_FILE), 'utf8'),
    );
    expect(raw.schema).toBe(USER_OVERLAY_DOCUMENT_SCHEMA_ID);

    expect(await deleteUserOverlayDocument(saved.id)).toBe(true);
    expect(await listUserOverlayDocuments()).toEqual([]);
    expect(await deleteUserOverlayDocument(saved.id)).toBe(false);
  });

  it('rejects documents that violate deterministic overlay lint', async () => {
    await expect(
      saveUserOverlayDocument({
        name: 'Bad',
        html: '<script>setTimeout(() => {}); window.__overlayReady = true;</script>',
        provenance: { kind: 'agent' },
        userConfirmed: true,
      }),
    ).rejects.toMatchObject({
      code: 'lint_failed',
      issues: expect.arrayContaining([
        expect.objectContaining({ rule: 'no-timers' }),
      ]),
    });

    expect(
      SaveUserOverlayDocumentInputSchema.safeParse({
        name: 'No opt in',
        html: VALID_DOCUMENT_HTML,
        provenance: { kind: 'agent' },
        userConfirmed: false,
      }).success,
    ).toBe(false);
  });
});
