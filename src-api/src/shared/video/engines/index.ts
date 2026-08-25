import { createHtmlAdapter } from './html-adapter';
import { createHyperframesAdapter } from './hyperframes-adapter';
import {
  type VideoEngineSummary,
  listVideoEngines,
  registerVideoEngine,
  tryGetVideoEngine,
} from './registry';
import { createRemotionAdapter } from './remotion-adapter';

export * from './types';
export * from './registry';
export * from './selection';
export { createRemotionAdapter } from './remotion-adapter';
export {
  createHtmlAdapter,
  HtmlEngineNotImplementedError,
} from './html-adapter';
export {
  createHyperframesAdapter,
  HyperframesEngineError,
} from './hyperframes-adapter';

/**
 * Register the built-in engines. Idempotent: a second call with both
 * adapters already present is a no-op. After `_resetVideoEngineRegistry()`
 * the next call re-registers, so test harnesses can cycle freely.
 */
export function ensureBuiltinVideoEnginesRegistered(): void {
  if (!tryGetVideoEngine('remotion')) {
    registerVideoEngine(createRemotionAdapter());
  }
  if (!tryGetVideoEngine('html')) {
    registerVideoEngine(createHtmlAdapter());
  }
  if (!tryGetVideoEngine('hyperframes')) {
    registerVideoEngine(createHyperframesAdapter());
  }
}

export async function listVideoEnginesWithBuiltins(): Promise<
  VideoEngineSummary[]
> {
  ensureBuiltinVideoEnginesRegistered();
  return listVideoEngines();
}
