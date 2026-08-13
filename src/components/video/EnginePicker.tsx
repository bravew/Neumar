// Phase 6 M2 — engine picker stub.
//
// Today the only engine wired into the HTML-video path is `html`. Render
// a read-only chip so the slot exists and Slice H (mux + MiniMax) can swap
// it for a real picker without re-laying out the project header.

interface EnginePickerProps {
  engineId?: string;
  label?: string;
}

export function EnginePicker({
  engineId = 'html',
  label = 'Engine',
}: EnginePickerProps) {
  return (
    <div
      className="flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
      aria-label={label}
      data-testid="engine-picker"
    >
      <span className="font-medium">{label}:</span>
      <span>{engineId}</span>
    </div>
  );
}
