import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReferenceStudyHandoff } from '@/components/video/reference/useReferenceStudyHandoff';
import {
  blockedSteps,
  completedStepCount,
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
          unblockPrompt: 'Paused at {step}: {reason} Clear it.',
          discussPrompt: 'I have the results for "{label}" open.',
          steps: {
            extract: 'Extracción',
            read: 'Lectura',
          },
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

  it('sends each handoff exactly once across effect re-runs', async () => {
    const sendMessage = vi.fn();
    const { rerender } = render(
      <Harness streaming={false} sendMessage={sendMessage} />,
    );

    act(() => {
      useReferenceStudyStore
        .getState()
        .requestHandoff({ referenceId: 'ref-1', label: 'iPhone_Duo' });
    });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    // Stands in for StrictMode's repeat effect run with the same request.
    rerender(<Harness streaming={false} sendMessage={sendMessage} />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it('asks about the open reading when the user opens the results', async () => {
    const sendMessage = vi.fn();
    render(<Harness streaming={false} sendMessage={sendMessage} />);

    act(() => {
      useReferenceStudyStore.getState().requestHandoff({
        referenceId: 'ref-1',
        label: 'iPhone_Duo',
        discussResults: true,
      });
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]?.[0]).toBe(
      'I have the results for "iPhone_Duo" open.',
    );
    // The reference id is what lets the agent answer against that reading.
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
      referenceId: 'ref-1',
    });
  });

  it('mirrors the dock stream state for the panel to poll against', () => {
    render(<Harness streaming sendMessage={vi.fn()} />);
    expect(useReferenceStudyStore.getState().agentStreaming).toBe(true);
  });
  it('counts only finished steps, so a parked run never reads as complete', () => {
    const parked = run({
      status: 'waiting',
      steps: [
        {
          id: 'sample',
          owner: 'system',
          status: 'done',
          producedArtifactIds: [],
        },
        {
          id: 'read',
          owner: 'agent',
          status: 'waiting',
          producedArtifactIds: [],
          note: 'Reading coverage is too thin (74% gaps).',
        },
        {
          id: 'extract',
          owner: 'agent',
          status: 'skipped',
          producedArtifactIds: [],
        },
      ],
    });

    expect(completedStepCount(parked)).toBe(1);
    expect(blockedSteps(parked).map((step) => step.id)).toEqual(['read']);
    expect(blockedSteps(parked)[0]?.note).toContain('74% gaps');
  });

  it('prefers the parked step reason over the generic ask', async () => {
    const sendMessage = vi.fn();
    render(<Harness streaming={false} sendMessage={sendMessage} />);

    act(() => {
      useReferenceStudyStore.getState().requestHandoff({
        referenceId: 'ref-1',
        label: 'iPhone_Duo',
        focus: 'editing rhythm',
        blocked: {
          stepId: 'extract',
          reason: 'Reading coverage is too thin (74% gaps).',
        },
      });
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    // A generic "build the structured reading" ask is wrong here: the reading
    // exists and the real blocker is coverage.
    expect(sendMessage.mock.calls[0]?.[0]).toContain('74% gaps');
    expect(sendMessage.mock.calls[0]?.[0]).not.toContain('editing rhythm');
  });

  it('sends the blocking reason when a handoff targets a parked step', async () => {
    const sendMessage = vi.fn();
    render(<Harness streaming={false} sendMessage={sendMessage} />);

    act(() => {
      useReferenceStudyStore.getState().requestHandoff({
        referenceId: 'ref-1',
        label: 'iPhone_Duo',
        blocked: { stepId: 'extract', reason: 'Coverage is too thin.' },
      });
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]?.[0]).toBe(
      'Paused at Extracción: Coverage is too thin. Clear it.',
    );
  });
});
