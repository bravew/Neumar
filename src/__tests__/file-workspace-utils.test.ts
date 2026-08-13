import { describe, expect, it } from 'vitest';

import {
  filterDesignFilesByKind,
  groupDesignFiles,
  pickInitialFile,
} from '@/components/design/file-workspace-utils';
import type { DesignFileEntry } from '@/shared/types/design-mode';

function file(path: string): DesignFileEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    isDir: false,
  };
}

describe('file workspace grouping', () => {
  it('does not select scaffold files as the fresh-project default', () => {
    expect(pickInitialFile([file('project.json'), file('brief.json')])).toBe(
      null,
    );
    expect(
      pickInitialFile([
        file('project.json'),
        file('prompts/system.md'),
        file('provenance/run.json'),
      ]),
    ).toBe(null);
  });

  it('still prefers generated artifacts', () => {
    expect(
      pickInitialFile([
        file('project.json'),
        file('brief.json'),
        file('artifacts/index.html'),
      ]),
    ).toBe('artifacts/index.html');
    expect(
      pickInitialFile([
        file('project.json'),
        file('brief.json'),
        file('README.md'),
      ]),
    ).toBe(null);
    expect(pickInitialFile([file('project.json')], 'outputs/final.png')).toBe(
      'outputs/final.png',
    );
  });

  it('groups SVG files with images instead of text files', () => {
    const groups = groupDesignFiles(
      [file('assets/logo.svg'), file('artifacts/readme.md')],
      'kind',
    );

    expect(groups.find((group) => group.id === 'image')?.files).toEqual([
      expect.objectContaining({ path: 'assets/logo.svg' }),
    ]);
    expect(groups.find((group) => group.id === 'text')?.files).toEqual([
      expect.objectContaining({ path: 'artifacts/readme.md' }),
    ]);
  });

  it('filters visible files by requested kind', () => {
    const files = [
      file('artifacts/index.html'),
      file('assets/photo.png'),
      file('assets/logo.svg'),
      file('exports/brief.pdf'),
      file('assets/music.mp3'),
    ];

    expect(filterDesignFilesByKind(files, 'image')).toEqual([
      expect.objectContaining({ path: 'assets/photo.png' }),
    ]);
    expect(filterDesignFilesByKind(files, 'svg')).toEqual([
      expect.objectContaining({ path: 'assets/logo.svg' }),
    ]);
    expect(filterDesignFilesByKind(files, 'pdf')).toEqual([
      expect.objectContaining({ path: 'exports/brief.pdf' }),
    ]);
  });
});
