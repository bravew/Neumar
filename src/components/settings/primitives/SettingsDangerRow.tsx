export function SettingsDangerRow({
  label,
  caption,
  actionLabel,
  onAction,
}: {
  label: string;
  caption: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-destructive text-sm">{label}</p>
        <p className="text-muted-foreground text-xs">{caption}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="border-destructive/40 text-destructive hover:bg-destructive/10 rounded-md border px-3 py-1.5 text-sm"
      >
        {actionLabel}
      </button>
    </div>
  );
}
