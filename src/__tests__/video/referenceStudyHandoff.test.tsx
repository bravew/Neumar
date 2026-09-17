import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReferenceStudyHandoff } from '@/components/video/reference/useReferenceStudyHandoff';
import {
  pendingAgentSteps,
  systemStepsSettled,
  useReferenceStudyStore,
} from '@/components/video/reference/useReferenceStudyStore';
import type { AgentDockContext } from '@/components/video/useAgentDock';
import type { VideoReferenceRun } from '@/shared/types/video';

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    t: {
      video: {
        reference: {
          handoffPrompt: 'Continue "{label}". Focus: {focus}.',
          handoffDefaultFocus: 'overall structure',
        },
      },
    },
  }),
}));

function run(overrides: Partial<VideoReferenceRun> = {}): VideoReferenceRun {
  return {
    id: 'run-1',
    referenceId: 'ref-1',
    status: 'running',
    revision: 1,
    sequence: 1,
    steps: [
      {
        id: 'sample',
        owner: 'system',
        status: 'done',
        producedArtifactIds: [],
      },
      { id: 'read', owner: 'agent', status: 'queued', producedArtifactIds: [] },
    ],
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

function Harness({
  streaming,
  sendMessage,
}: {
  streaming: boolean;
  sendMessage: (content: string, context: AgentDockContext) => void;
}) {
  useReferenceStudyHandoff({
    streaming,
    sendMessage,
    buildContext: () => ({ step: 'preview' }),
  });
  return null;
}

describe('reference study handoff', () => {
  beforeEach(() => {
    useReferenceStudyStore.setState({
      projectId: null,
      activeReferenceId: null,
      runs: {},
      handoff: null,
      agentStreaming: false,
    });
  });

  it('reports the agent-owned steps a run is parked on', () => {
    expect(pendingAgentSteps(run())).toEqual(['read']);
    expect(
      pendingAgentSteps(
        run({
          steps: [
            {
              id: 'read',
              owner: 'agent',
              status: 'done',
              producedArtifactIds: [],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('waits for the system steps to settle before the run counts as parked', () => {
    expect(systemStepsSettled(run())).toBe(true);
    expect(
      systemStepsSettled(
        run({
          steps: [
            {
              id: 'sample',
              owner: 'system',
              status: 'running',
              producedArtifactIds: [],
            },
            {
              id: 'read',
              owner: 'agent',
              status: 'queued',
              producedArtifactIds: [],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('turns a panel handoff into a chat turn carrying the reference id', async () => {
    const sendMessage = vi.fn();
    render(<Harness streaming={false} sendMessage={sendMessage} />);

    act(() => {
      useReferenceStudyStore.getState().requestHandoff({
        referenceId: 'ref-1',
        label: 'iPhone_Duo',
        focus: 'editing rhythm',
      });
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith(
      'Continue "iPhone_Duo". Focus: editing rhythm.',
      { step: 'preview', referenceId: 'ref-1' },
    );
    expect(useReferenceStudyStore.getState().handoff).toBeNull();
  });

  it('holds the handoff while a turn is already streaming', async () => {
    const sendMessage = vi.fn();
    const { rerender } = render(
      <Harness streaming sendMessage={sendMessage} />,
    );

    act(() => {
      useReferenceStudyStore
        .getState()
        .requestHandoff({ referenceId: 'ref-1', label: 'iPhone_Duo' });
    });
    expect(sendMessage).not.toHaveBeenCalled();

    rerender(<Harness streaming={false} sendMessage={sendMessage} />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]?.[0]).toBe(
      'Continue "iPhone_Duo". Focus: overall structure.',
    );
  });

  it('drops a deleted reference from panel state', () => {
    useReferenceStudyStore.setState({
      runs: { 'ref-1': run(), 'ref-2': run({ referenceId: 'ref-2' }) },
      activeReferenceId: 'ref-1',
      handoff: { referenceId: 'ref-1', label: 'iPhone_Duo', nonce: 1 },
    });

    useReferenceStudyStore.getState().forgetReference('ref-1');

    const state = useReferenceStudyStore.getState();
    expect(Object.keys(state.runs)).toEqual(['ref-2']);
    expect(state.activeReferenceId).toBeNull();
    expect(state.handoff).toBeNull();
  });

  it('keeps unrelated references when one is deleted', () => {
    useReferenceStudyStore.setState({
      runs: { 'ref-2': run({ referenceId: 'ref-2' }) },
      activeReferenceId: 'ref-2',
      handoff: { referenceId: 'ref-2', label: 'other', nonce: 1 },
    });

    useReferenceStudyStore.getState().forgetReference('ref-1');

    const state = useReferenceStudyStore.getState();
    expect(Object.keys(state.runs)).toEqual(['ref-2']);
    expect(state.activeReferenceId).toBe('ref-2');
    expect(state.handoff).not.toBeNull();
  });

  it('mirrors the dock stream state for the panel to poll against', () => {
    render(<Harness streaming sendMessage={vi.fn()} />);
    expect(useReferenceStudyStore.getState().agentStreaming).toBe(true);
  });
});
