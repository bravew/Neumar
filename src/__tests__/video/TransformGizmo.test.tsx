import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TransformGizmo } from '@/components/video/preview/TransformGizmo';

describe('TransformGizmo', () => {
  it('substitutes resize handle positions in accessible titles', () => {
    const { container } = render(
      <TransformGizmo
        bounds={{ cx: 120, cy: 160, h: 90, rotation: 0, w: 140 }}
        labels={{
          move: 'Move',
          resize: 'Resize {position}',
          rotate: 'Rotate',
        }}
        onHandlePointerDown={vi.fn()}
      />,
    );

    const titles = [...container.querySelectorAll('title')].map(
      (node) => node.textContent,
    );

    expect(titles).not.toContain('Resize {position}');
    expect(titles).toEqual(
      expect.arrayContaining([
        'Resize NW',
        'Resize N',
        'Resize NE',
        'Resize E',
        'Resize SE',
        'Resize S',
        'Resize SW',
        'Resize W',
      ]),
    );
  });
});
