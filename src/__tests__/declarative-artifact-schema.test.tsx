import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeclarativeArtifact } from '@/components/artifacts/declarative/DeclarativeArtifact';
import {
  A2UI_VERSION,
  parseDeclarativeArtifact,
} from '@/components/artifacts/declarative/schema';

import { renderWithProviders } from './helpers/render-with-providers';

describe('declarative artifact schema', () => {
  it('parses the pinned A2UI subset', () => {
    const spec = parseDeclarativeArtifact(
      JSON.stringify({
        version: A2UI_VERSION,
        root: {
          type: 'Card',
          children: [
            { type: 'Heading', text: 'Review request' },
            {
              type: 'List',
              props: { items: ['one', 'two'] },
            },
          ],
        },
      }),
    );

    expect(spec.root.type).toBe('Card');
  });

  it('rejects unknown node types', () => {
    expect(() =>
      parseDeclarativeArtifact(
        JSON.stringify({
          version: A2UI_VERSION,
          root: { type: 'RawHtml', text: '<script />' },
        }),
      ),
    ).toThrow();
  });

  it('dispatches host action events with form values', () => {
    const events: unknown[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail);
    };
    window.addEventListener('neuma:declarative-artifact-action', listener);

    try {
      renderWithProviders(
        <DeclarativeArtifact
          content={JSON.stringify({
            version: A2UI_VERSION,
            root: {
              type: 'Card',
              children: [
                {
                  type: 'TextField',
                  props: { label: 'Summary', name: 'summary' },
                },
                {
                  type: 'Button',
                  text: 'Submit',
                  props: { action: 'submit-review' },
                },
              ],
            },
            actions: [{ id: 'submit-review', label: 'Submit' }],
          })}
        />,
      );

      fireEvent.change(screen.getByLabelText('Summary'), {
        target: { value: 'Looks good' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

      expect(events).toEqual([
        {
          actionId: 'submit-review',
          values: { summary: 'Looks good' },
          version: A2UI_VERSION,
        },
      ]);
    } finally {
      window.removeEventListener('neuma:declarative-artifact-action', listener);
    }
  });
});
