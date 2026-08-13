import { describe, expect, it } from 'vitest';

import {
  extractFilePaths,
  extractMediaPaths,
  videoMediaAssetIngestHook,
} from '@/extensions/agent/video/asset-ingest-hook';

describe('asset-ingest-hook', () => {
  describe('matcher', () => {
    it('runs on every tool result (no matcher); handler filters by project-dir containment', () => {
      // The hook intentionally has no `matcher` so canvas-design, ffmpeg,
      // future MCP servers — anything dropping media into the project tree —
      // gets surfaced without per-tool matcher edits. Containment is checked
      // inside the handler via `getVideoProjectDir`.
      expect(videoMediaAssetIngestHook.matcher).toBeUndefined();
    });
  });

  describe('extractFilePaths', () => {
    it('parses File: lines from a media MCP text-content payload', () => {
      const result = {
        content: [
          {
            type: 'text',
            text: [
              '**Image 1**:',
              '  File: /Users/example/.neumar/videos/proj-1/output/out-abc.png',
              '',
              '**Image 2**:',
              '  File: /Users/example/.neumar/videos/proj-1/output/out-def.png',
              '',
              'Iteration budget: 2/3',
            ].join('\n'),
          },
        ],
      };
      expect(extractFilePaths(result)).toEqual([
        '/Users/example/.neumar/videos/proj-1/output/out-abc.png',
        '/Users/example/.neumar/videos/proj-1/output/out-def.png',
      ]);
    });

    it('parses raw string results', () => {
      expect(
        extractFilePaths('File: /workspace/videos/p/output/x.mp4'),
      ).toEqual(['/workspace/videos/p/output/x.mp4']);
    });

    it('returns empty list when no File: lines exist', () => {
      expect(extractFilePaths('Image generated successfully')).toEqual([]);
      expect(extractFilePaths(null)).toEqual([]);
      expect(extractFilePaths(undefined)).toEqual([]);
      expect(extractFilePaths({ content: [] })).toEqual([]);
    });

    it('parses the SDK PostToolUse shape — tool_response as a bare content array', () => {
      // What the Claude Agent SDK actually passes to PostToolUse hooks:
      // the array directly, NOT wrapped in { content: ... }.
      const result = [
        {
          type: 'text',
          text:
            '🎨 **Attempt 1 this turn** — ✅ Generated 1 image(s)\n\n' +
            '**Image 1**:\n' +
            ' File: /Volumes/4TB_WD/_Neumar/videos/proj-1/assets/out-441b220e-0.png',
        },
      ];
      expect(extractFilePaths(result)).toEqual([
        '/Volumes/4TB_WD/_Neumar/videos/proj-1/assets/out-441b220e-0.png',
      ]);
    });

    it('parses indented File: lines with leading whitespace', () => {
      // The real media-server output uses two-space indent under
      // `**Image N**:`. The original anchored regex (^\s*File:\s+…$/m)
      // missed it under some SDK paths because newlines were normalized.
      const text = [
        '**Image 1**:',
        '  File: /workspace/proj/assets/foo.png',
        '',
      ].join('\n');
      expect(extractFilePaths(text)).toEqual([
        '/workspace/proj/assets/foo.png',
      ]);
    });

    it('parses File: from a JSON-stringified blob (unknown shape fallback)', () => {
      // Belt-and-suspenders: if the SDK passes us an unknown wrapper,
      // JSON.stringify still leaves the substring `File: /path` intact.
      const stringified = {
        unexpected: 'wrapper',
        payload: {
          message: 'File: /some/place/out.mp4 was made',
        },
      };
      expect(extractFilePaths(stringified)).toEqual(['/some/place/out.mp4']);
    });

    it('deduplicates repeated paths within a single result', () => {
      const result = ['  File: /tmp/out.png', '  File: /tmp/out.png'].join(
        '\n',
      );
      expect(extractFilePaths(result)).toEqual(['/tmp/out.png']);
    });

    it('ignores relative paths and non-file lines', () => {
      const result = [
        '  File: ./relative/path.png',
        '  Url: https://example.com/foo.png',
        '  File: /abs/ok.png',
      ].join('\n');
      expect(extractFilePaths(result)).toEqual(['/abs/ok.png']);
    });
  });

  describe('extractMediaPaths', () => {
    it('extracts any absolute media path from arbitrary tool output', () => {
      // For tools that don't emit `File: /path` — e.g. canvas-design,
      // ffmpeg, future skills — the handler falls back to this broader
      // scan and then filters by project-dir containment.
      const result = `Saved title card to /workspace/proj/output/title.png and the trailer to /workspace/proj/assets/intro.mp4.`;
      expect(extractMediaPaths(result)).toEqual([
        '/workspace/proj/output/title.png',
        '/workspace/proj/assets/intro.mp4',
      ]);
    });

    it('ignores non-media extensions', () => {
      expect(
        extractMediaPaths('Wrote /tmp/notes.txt and /tmp/log.json'),
      ).toEqual([]);
    });
  });
});
