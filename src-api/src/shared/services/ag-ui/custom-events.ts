/**
 * Schemas for our CUSTOM AG-UI events.
 * These extend the protocol for neuma-specific UI features.
 */

export type PlanCustomEvent = {
  type: 'CUSTOM';
  name: 'plan';
  value: {
    steps: Array<{
      id: string;
      title: string;
      status: 'pending' | 'active' | 'done' | 'error';
    }>;
    estimatedDuration?: number;
  };
};

export type DirectAnswerCustomEvent = {
  type: 'CUSTOM';
  name: 'direct_answer';
  value: string;
};

export type ContextOverflowCustomEvent = {
  type: 'CUSTOM';
  name: 'context_overflow';
  value: {
    usedTokens: number;
    maxTokens: number;
    recommendation: 'summarize' | 'branch' | 'clear';
  };
};

export type InterruptCustomEvent = {
  type: 'CUSTOM';
  name: 'interrupt';
  value: {
    reason: 'plan_approval' | 'permission_request' | 'external_action';
    payload: unknown;
  };
};

export type NeumaCustomEvent =
  | PlanCustomEvent
  | DirectAnswerCustomEvent
  | ContextOverflowCustomEvent
  | InterruptCustomEvent;
