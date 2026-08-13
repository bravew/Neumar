export function RunErrorBubble({
  errorLabel,
  message,
  onDismiss,
}: {
  errorLabel: string;
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
      <svg
        className="mt-0.5 size-4 shrink-0 text-red-500"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          {errorLabel}
        </p>
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300"
        aria-label="Dismiss"
      >
        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  );
}
