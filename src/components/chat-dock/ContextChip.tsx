export function ContextChip({
  label,
  onRemove,
  removeLabel,
}: {
  label: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs">
      <span>{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        className="text-muted-foreground hover:text-foreground"
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}
