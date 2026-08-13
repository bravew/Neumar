// Typed errors for the HTML video render engine. Centralised so the adapter,
// capture wrapper, browser provisioner, and renderToHtml builder all surface
// the same discriminated union to callers — and the agent + UI can map them
// to localised messages by code (Phase 6 M2).

export type HtmlEngineErrorCode =
  | 'browser-launch-failed'
  | 'browser-aborted'
  | 'template-source-missing'
  | 'capture-failed'
  | 'mux-failed'
  | 'output-path-invalid'
  | 'duration-out-of-range';

export class HtmlEngineError extends Error {
  constructor(
    public readonly code: HtmlEngineErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HtmlEngineError';
  }
}
