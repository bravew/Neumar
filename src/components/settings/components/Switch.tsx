import { useEffect } from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Props for the Switch component.
 *
 * At least one of `label` or `aria-labelledby` should be provided so that
 * screen readers can identify what the switch controls. A development-only
 * warning is logged when neither is present.
 */
interface SwitchProps {
  /** Whether the switch is toggled on */
  checked: boolean;
  /** Callback when the switch is toggled */
  onChange: (checked: boolean) => void;
  /** Whether the switch is disabled */
  disabled?: boolean;
  /** Accessible label describing what this switch controls */
  label?: string;
  /** ID of an external element that labels this switch */
  'aria-labelledby'?: string;
}

/**
 * Accessible toggle switch component.
 *
 * Uses `role="switch"` and `aria-checked` for proper screen reader support.
 * Provide either `label` (maps to `aria-label`) or `aria-labelledby` so
 * assistive technology can announce what the switch controls.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  'aria-labelledby': ariaLabelledBy,
}: SwitchProps) {
  // Development-only warning when no accessible name is provided
  useEffect(() => {
    if (import.meta.env.DEV && !label && !ariaLabelledBy) {
      console.warn(
        '[Switch] Missing accessible name: provide either `label` or `aria-labelledby` so screen readers can identify this switch.',
      );
    }
    // Only check once on mount — the label is not expected to change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={ariaLabelledBy}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) {
          onChange(!checked);
        }
      }}
      disabled={disabled}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}
