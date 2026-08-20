import { describe, expect, it } from 'vitest';

import type { Artifact } from '@/components/artifacts/types';
import {
  filterOutputArtifactMedia,
  getPreviewableOutputArtifacts,
} from '@/components/task/outputArtifactMedia';

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

describe('getPreviewableOutputArtifacts', () => {
  it('keeps final media but omits render-frame sequences from chat', () => {
    const artifacts = [
      imageArtifact({
        id: 'frame-1',
        name: 'frame_0001.png',
        path: '/tmp/session/output/agent_system_frames_2/frame_0001.png',
      }),
      imageArtifact({
        id: 'frame-pattern',
        name: 'frame_%04d.png',
        path: '/tmp/session/output/agent_system_frames_2/frame_%04d.png',
      }),
      imageArtifact({
        id: 'video-1',
        name: 'agent-system-illustration.mp4',
        path: '/tmp/session/output/agent-system-illustration.mp4',
        type: 'video',
      }),
    ];

    expect(getPreviewableOutputArtifacts(artifacts).map((a) => a.name)).toEqual(
      ['agent-system-illustration.mp4'],
    );
  });
});
