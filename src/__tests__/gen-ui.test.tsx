import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GenUIRenderer } from '@/components/shared/chat-panel';
import { parseGenUIEnvelope } from '@/shared/types/gen-ui';

describe('GenUI schema', () => {
  it('parses a typed envelope from JSON text', () => {
    const envelope = parseGenUIEnvelope(
      JSON.stringify({
        $genui: 'MediaCard',
        props: {
          path: '/tmp/session/output/frame.png',
          kind: 'image',
          title: 'frame.png',
        },
      }),
    );

    expect(envelope?.$genui).toBe('MediaCard');
    expect(envelope?.props.title).toBe('frame.png');
  });

  it('parses fenced JSON from tool output', () => {
    const envelope = parseGenUIEnvelope(`\`\`\`json
{"$genui":"StatusCard","props":{"status":"success","title":"Done"}}
\`\`\``);

    if (envelope?.$genui !== 'StatusCard') {
      throw new Error('Expected StatusCard envelope');
    }
    expect(envelope.props.status).toBe('success');
  });

  it('rejects untyped JSON objects', () => {
    expect(parseGenUIEnvelope('{"title":"plain object"}')).toBeNull();
  });

  it('rejects unsafe link schemes', () => {
    expect(
      parseGenUIEnvelope({
        $genui: 'LinkCard',
        props: {
          href: 'javascript:alert(1)',
          title: 'Bad link',
        },
      }),
    ).toBeNull();
  });

  it('rejects unsafe file card urls', () => {
    expect(
      parseGenUIEnvelope({
        $genui: 'FileCard',
        props: {
          url: 'javascript:alert(1)',
          title: 'Bad file',
        },
      }),
    ).toBeNull();
  });

  it('strips unknown envelope and props fields', () => {
    const envelope = parseGenUIEnvelope({
      $genui: 'StatusCard',
      unexpected: true,
      props: {
        status: 'info',
        title: 'Ready',
        extra: 'ignored',
      },
    });

    expect(envelope?.$genui).toBe('StatusCard');
    expect('unexpected' in (envelope as Record<string, unknown>)).toBe(false);
    expect('extra' in (envelope?.props as Record<string, unknown>)).toBe(false);
  });
});

describe('GenUIRenderer', () => {
  it('renders link cards without exposing raw JSON', () => {
    const envelope = parseGenUIEnvelope({
      $genui: 'LinkCard',
      props: {
        href: 'https://example.com/report',
        title: 'Report',
        description: 'Published output',
      },
    });

    expect(envelope).not.toBeNull();
    render(<GenUIRenderer envelope={envelope!} />);

    expect(screen.getByRole('link', { name: /report/i })).toHaveAttribute(
      'href',
      'https://example.com/report',
    );
    expect(screen.getByText('Published output')).toBeInTheDocument();
  });

  it('renders table cards from object rows', () => {
    const envelope = parseGenUIEnvelope({
      $genui: 'TableCard',
      props: {
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'score', label: 'Score' },
        ],
        rows: [{ id: 'alpha', name: 'Alpha', score: 3 }],
      },
    });

    expect(envelope).not.toBeNull();
    render(<GenUIRenderer envelope={envelope!} />);

    expect(
      screen.getByRole('columnheader', { name: 'Name' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument();
  });
});
