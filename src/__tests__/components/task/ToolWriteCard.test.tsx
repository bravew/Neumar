import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ToolExecutionItem } from '@/components/task/tool-execution/ToolExecutionItem';
import type { AgentMessage } from '@/shared/hooks/agent-types';

import { renderWithProviders } from '../../helpers/render-with-providers';

describe('ToolExecutionItem write card', () => {
  it('shows structured file write metadata without dumping file content', () => {
    const message: AgentMessage = {
      type: 'tool_use',
      id: 'tool-1',
      name: 'write_file',
      input: {
        path: 'src/App.tsx',
        content: 'line one\nline two',
      },
    };
    const result: AgentMessage = {
      type: 'tool_result',
      toolUseId: 'tool-1',
      output: 'ok',
    };

    renderWithProviders(
      <ToolExecutionItem message={message} result={result} isLast={false} />,
    );

    expect(screen.getByText('File write')).toBeInTheDocument();
    expect(screen.getByText('Path: src/App.tsx')).toBeInTheDocument();
    expect(screen.getByText(/2 lines/)).toBeInTheDocument();
    expect(screen.queryByText('line one')).not.toBeInTheDocument();
  });
});
