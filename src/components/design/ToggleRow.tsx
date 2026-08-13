export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-md border p-3 text-sm"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span
        className="bg-muted data-[checked=true]:bg-primary relative h-6 w-11 rounded-full"
        data-checked={checked}
      >
        <span
          className="bg-background absolute top-1 left-1 size-4 rounded-full transition-transform data-[checked=true]:translate-x-5"
          data-checked={checked}
        />
      </span>
    </button>
  );
}
