interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  minLabel: string;
  maxLabel: string;
  parse?: 'float' | 'int';
}

/** Labeled range input with min/max tick labels below. */
export function RangeSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  minLabel,
  maxLabel,
  parse = 'float',
}: RangeSliderProps) {
  return (
    <div>
      <label className="text-foreground/80 mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          onChange(
            parse === 'int'
              ? parseInt(e.target.value, 10)
              : parseFloat(e.target.value),
          )
        }
        className="accent-primary w-full"
        aria-label={label}
      />
      <div className="text-muted-foreground mt-0.5 flex justify-between text-xs">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
