import { useEffect, useEffectEvent } from 'react';

export const IDEAS_PREFILL_EVENT = 'ideas:prefill';

let pending: string | null = null;

/**
 * Hands a prompt to the next composer. A mounted listener (the open dock)
 * claims it from the event; otherwise it waits for the composer that mounts
 * next, so callers can prefill and then navigate home.
 *
 * Returns true when a mounted composer already claimed the prompt.
 */
export function requestComposerPrefill(prompt: string): boolean {
  pending = prompt;
  window.dispatchEvent(
    new CustomEvent(IDEAS_PREFILL_EVENT, { detail: { prompt } }),
  );
  return pending === null;
}

/** Claims the waiting prompt, if any. Each prompt is claimed once. */
export function takeComposerPrefill(): string | null {
  const prompt = pending;
  pending = null;
  return prompt;
}

/**
 * Lets a page composer receive prompts sent before it mounted (prefill, then
 * navigate) and while it is on screen.
 */
export function useComposerPrefill(onPrefill: (prompt: string) => void) {
  const deliver = useEffectEvent(onPrefill);

  useEffect(() => {
    const claim = () => {
      const prompt = takeComposerPrefill();
      if (prompt !== null) deliver(prompt);
    };
    claim();
    window.addEventListener(IDEAS_PREFILL_EVENT, claim);
    return () => window.removeEventListener(IDEAS_PREFILL_EVENT, claim);
  }, []);
}
