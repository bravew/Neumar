import { useEffect, useSyncExternalStore } from 'react';

export interface PageContextValue {
  label: string;
  payload: string;
}

let current: PageContextValue | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setPageContext(value: PageContextValue | null) {
  current = value;
  emit();
}

export function getPageContext(): PageContextValue | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePageContextValue(): PageContextValue | null {
  return useSyncExternalStore(subscribe, getPageContext, getPageContext);
}

export function useRegisterPageContext(value: PageContextValue | null) {
  const label = value?.label;
  const payload = value?.payload;
  useEffect(() => {
    if (!label || !payload) {
      setPageContext(null);
      return;
    }
    setPageContext({ label, payload });
    return () => setPageContext(null);
  }, [label, payload]);
}
