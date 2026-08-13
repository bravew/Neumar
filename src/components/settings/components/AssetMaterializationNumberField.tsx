interface AssetMaterializationNumberFieldProps {
  label: string;
  description: string;
  value: string;
  min: number;
  step: number;
  suffix: string;
  onChange: (value: string) => void;
}

export function AssetMaterializationNumberField({
  label,
  description,
  value,
  min,
  step,
  suffix,
  onChange,
}: AssetMaterializationNumberFieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-foreground text-sm font-medium">{label}</span>
      <span className="border-input bg-background flex items-center rounded-md border">
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
        />
        <span className="text-muted-foreground border-l px-3 text-xs">
          {suffix}
        </span>
      </span>
      <span className="text-muted-foreground block text-xs">{description}</span>
    </label>
  );
}
