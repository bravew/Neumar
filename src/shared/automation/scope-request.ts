export const AUTOMATION_SCOPE_EVENT = 'automation:scope';

export interface AutomationScopeRequest {
  category: string;
  questions: string[];
}

let pending: AutomationScopeRequest | null = null;

/**
 * Hands a scoping request to the chat dock. A mounted dock claims it from the
 * event; a closed dock is opened by the caller and claims it when it mounts, so
 * the request survives the gap before the dock's listener exists.
 */
export function requestAutomationScope(request: AutomationScopeRequest): void {
  pending = request;
  window.dispatchEvent(new CustomEvent(AUTOMATION_SCOPE_EVENT));
}

/** Claims the waiting request, if any. Each request is claimed once. */
export function takeAutomationScope(): AutomationScopeRequest | null {
  const request = pending;
  pending = null;
  return request;
}
