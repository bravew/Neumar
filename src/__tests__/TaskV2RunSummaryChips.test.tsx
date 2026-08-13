import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import { TaskV2RunSummaryChips } from '@/components/task/TaskV2RunSummaryChips';

import { renderWithProviders } from './helpers/render-with-providers';

describe('TaskV2RunSummaryChips', () => {
  it('renders tool, mcp, file, context, and recovery chips', () => {
    const message: AGUIMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content:
        'Used Figma and Code Connect context packs with design tokens before recovery.',
      subtype: 'run_error_summary',
      toolCalls: [
        {
          id: 'tool-figma',
          type: 'function',
          function: {
            name: 'mcp__figma__get_node',
            arguments: '{}',
          },
        },
        {
          id: 'tool-write',
          type: 'function',
          function: {
            name: 'Write',
            arguments: JSON.stringify({ file_path: 'src/App.tsx' }),
          },
        },
      ],
    };

    renderWithProviders(
      <TaskV2RunSummaryChips
        message={message}
        allArtifacts={[
          {
            id: 'artifact-1',
            name: 'App.tsx',
            type: 'code',
            path: 'src/App.tsx',
            sourceToolCallId: 'tool-write',
          },
        ]}
      />,
    );

    const summary = screen.getByLabelText('Run summary');
    expect(summary).toHaveTextContent('Tools 2');
    expect(summary).toHaveTextContent('MCP figma');
    expect(summary).toHaveTextContent('File App.tsx');
    expect(summary).toHaveTextContent('Figma');
    expect(summary).toHaveTextContent('Code Connect');
    expect(summary).toHaveTextContent('Tokens');
    expect(summary).toHaveTextContent('Recovery');
  });

  it('does not render an empty adjunct', () => {
    const { container } = renderWithProviders(
      <TaskV2RunSummaryChips message={{ id: 'm1', role: 'assistant' }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('does not report a written artifact that the run later deleted', () => {
    renderWithProviders(
      <TaskV2RunSummaryChips
        message={{
          id: 'm-delete',
          role: 'assistant',
          toolCalls: [
            {
              id: 'write',
              name: 'Write',
              args: { file_path: 'temporary.md' },
            },
            {
              id: 'delete',
              name: 'Delete',
              args: { path: 'temporary.md' },
            },
          ],
        }}
        allArtifacts={[
          {
            id: 'temporary',
            name: 'temporary.md',
            type: 'code',
            path: 'temporary.md',
            sourceToolCallId: 'write',
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('Run summary')).not.toHaveTextContent('File');
  });
});
