import type { ReactNode } from 'react';

import type { FormField } from '@/shared/video/useFormSpec';

interface FieldShellProps {
  field: FormField;
  children: ReactNode;
}

export function FieldShell({ field, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {field.label}
        {field.required ? (
          <span className="ml-1 text-rose-500" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {field.helpText ? (
        <p className="text-xs text-zinc-500">{field.helpText}</p>
      ) : null}
      {field.warnings.length > 0 ? (
        <ul className="text-xs text-amber-600">
          {field.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
