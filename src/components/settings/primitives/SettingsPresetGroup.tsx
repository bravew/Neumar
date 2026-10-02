import { cn } from '@/shared/lib/utils';

export function SettingsPresetGroup({
  legend,
  value,
  options,
  onValueChange,
}: {
  legend: string;
  value: string;
  options: { value: string; label: string; caption?: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-foreground text-sm font-medium">{legend}</legend>
      <div className="grid gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'border-border flex cursor-pointer gap-3 rounded-xl border p-3',
                selected && 'border-primary bg-primary/5',
              )}
            >
              <input
                type="radio"
                name={legend}
                value={option.value}
                checked={selected}
                onChange={() => onValueChange(option.value)}
              />
              <span>
                <span className="text-foreground block text-sm">
                  {option.label}
                </span>
                {option.caption ? (
                  <span className="text-muted-foreground block text-xs">
                    {option.caption}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
