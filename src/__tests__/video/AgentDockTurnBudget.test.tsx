import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentDockTurnBudget } from '@/components/video/AgentDockTurnBudget';

import { renderWithProviders as render } from '../helpers/render-with-providers';

describe('AgentDockTurnBudget', () => {
  it('renders nothing for a clean finish', () => {
    const { container } = render(
      <AgentDockTurnBudget
        outcome={{ reason: 'end_turn', exhausted: false }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before a run has ended', () => {
    const { container } = render(<AgentDockTurnBudget outcome={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the turn ceiling and offers to continue when exhausted', () => {
    const onContinue = vi.fn();
    render(
      <AgentDockTurnBudget
        outcome={{ reason: 'max_steps', exhausted: true, limit: 60 }}
        onContinue={onContinue}
      />,
    );
    expect(
      screen.getByText(
        'The agent stopped at its turn limit (60) before finishing.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('explains a non-ceiling stop without offering to continue', () => {
    render(
      <AgentDockTurnBudget
        outcome={{ reason: 'refusal', exhausted: false }}
        onContinue={() => undefined}
      />,
    );
    expect(
      screen.getByText('The agent declined to continue this request.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Continue')).toBeNull();
  });

  it('falls back to the unknown copy for an unmapped reason', () => {
    render(
      <AgentDockTurnBudget outcome={{ reason: 'unknown', exhausted: false }} />,
    );
    expect(
      screen.getByText('The run ended for an unknown reason.'),
    ).toBeInTheDocument();
  });
});
