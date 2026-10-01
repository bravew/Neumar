import { describe, expect, it } from 'vitest';

import {
  mapActivityLines,
  type ActivityEvent,
  type ActivityKind,
} from '@/components/task/activity-lines';

const ROOT = '/sessions/demo';

const cases: {
  kind: ActivityKind;
  event: ActivityEvent;
  label: string;
  path?: string;
  linksToDiff: boolean;
}[] = [
  {
    kind: 'read',
    event: {
      type: 'tool_use',
      name: 'Read',
      id: 'read-1',
      input: { file_path: `${ROOT}/80s-video.webm` },
    },
    label: '80s-video.webm',
    path: `${ROOT}/80s-video.webm`,
    linksToDiff: false,
  },
  {
    kind: 'write',
    event: {
      type: 'tool_use',
      name: 'Write',
      id: 'write-1',
      input: { file_path: `${ROOT}/output/80s-video.mp4` },
    },
    label: 'output/80s-video.mp4',
    path: `${ROOT}/output/80s-video.mp4`,
    linksToDiff: true,
  },
  {
    kind: 'edit',
    event: {
      type: 'tool_use',
      name: 'Edit',
      id: 'edit-1',
      input: { file_path: `${ROOT}/notes.md` },
    },
    label: 'notes.md',
    path: `${ROOT}/notes.md`,
    linksToDiff: true,
  },
  {
    kind: 'bash',
    event: {
      type: 'tool_use',
      name: 'Bash',
      id: 'bash-1',
      input: { command: 'ffmpeg -i 80s-video.webm output/80s-video.mp4' },
    },
    label: 'ffmpeg',
    linksToDiff: false,
  },
  {
    kind: 'web',
    event: {
      type: 'tool_use',
      name: 'WebFetch',
      id: 'web-1',
      input: { url: 'https://example.com/spec' },
    },
    label: 'https://example.com/spec',
    linksToDiff: false,
  },
  {
    kind: 'search',
    event: {
      type: 'tool_use',
      name: 'WebSearch',
      id: 'search-1',
      input: { query: 'muse shell' },
    },
    label: 'muse shell',
    linksToDiff: false,
  },
  {
    kind: 'mcp',
    event: {
      type: 'tool_use',
      name: 'mcp__publish__post',
      id: 'mcp-1',
      input: {},
    },
    label: 'post',
    linksToDiff: false,
  },
  {
    kind: 'approval',
    event: {
      type: 'permission_request',
      id: 'perm-1',
      permission: { description: 'Wants to publish' },
    },
    label: 'Wants to publish',
    linksToDiff: false,
  },
  {
    kind: 'other',
    event: {
      type: 'tool_use',
      name: 'TodoWrite',
      id: 'todo-1',
      input: {},
    },
    label: 'TodoWrite',
    linksToDiff: false,
  },
];

describe('mapActivityLines', () => {
  it.each(cases)('maps $kind', ({ kind, event, label, path, linksToDiff }) => {
    const [line] = mapActivityLines([event], ROOT);
    expect(line.kind).toBe(kind);
    expect(line.label).toBe(label);
    expect(line.path).toBe(path);
    expect(line.linksToDiff).toBe(linksToDiff);
  });

  it('ignores text that is not a tool or approval', () => {
    expect(
      mapActivityLines([{ type: 'text', id: 't', name: 'Read' }], ROOT),
    ).toEqual([]);
  });
});
