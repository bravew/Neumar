import { describe, expect, it } from 'vitest';

import type { Artifact } from '@/components/artifacts/types';
import { filterOutputArtifactMedia } from '@/components/task/outputArtifactMedia';

function imageArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: overrides.id ?? 'artifact-1',
    name: overrides.name ?? 'card_cropped.jpg',
    type: overrides.type ?? 'image',
    path:
      overrides.path ??
      '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/card_cropped.jpg',
    isOutput: overrides.isOutput ?? true,
  };
}

describe('filterOutputArtifactMedia', () => {
  it('removes path-extracted media already rendered as output artifacts', () => {
    const outputPath =
      '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/card_cropped.jpg';
    const sourcePath =
      '/Volumes/4TB_WD/_Neumar/sessions/session-1/attachments/source.jpg';

    const filtered = filterOutputArtifactMedia(
      {
        videos: [],
        images: [{ path: outputPath }, { path: sourcePath }],
        pdfs: [],
        documents: [],
      },
      [imageArtifact({ path: outputPath })],
    );

    expect(filtered.images).toEqual([{ path: sourcePath }]);
  });

  it('keeps path-extracted media for non-output artifacts', () => {
    const sourcePath =
      '/Volumes/4TB_WD/_Neumar/sessions/session-1/attachments/source.jpg';

    const filtered = filterOutputArtifactMedia(
      {
        videos: [],
        images: [{ path: sourcePath }],
        pdfs: [],
        documents: [],
      },
      [imageArtifact({ path: sourcePath, isOutput: false })],
    );

    expect(filtered.images).toEqual([{ path: sourcePath }]);
  });

  it('keeps output document chips that are not rendered by media previews', () => {
    const documentPath =
      '/Volumes/4TB_WD/_Neumar/sessions/session-1/output/notes.pdf';

    const filtered = filterOutputArtifactMedia(
      {
        videos: [],
        images: [],
        pdfs: [{ path: documentPath }],
        documents: [],
      },
      [
        {
          id: 'pdf-1',
          name: 'notes.pdf',
          type: 'pdf',
          path: documentPath,
          isOutput: true,
        },
      ],
    );

    expect(filtered.pdfs).toEqual([{ path: documentPath }]);
  });
});
