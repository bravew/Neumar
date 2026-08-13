import type { ReactNode } from 'react';

import type { FormField } from '@/shared/video/useFormSpec';

export type VariableValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | null;

export type VariableMap = Record<string, VariableValue>;

export interface ControlProps<F extends FormField = FormField> {
  field: F;
  value: VariableValue;
  onChange: (next: VariableValue) => void;
  disabled?: boolean;
}

export interface RenderFieldArgs {
  field: FormField;
  value: VariableValue;
  onChange: (next: VariableValue) => void;
  disabled?: boolean;
}

/**
 * Renders one field by kind. Injected into the recursive controls (fieldset /
 * table) so they can render their sub-fields without importing the dispatcher
 * (avoids an import cycle).
 */
export type RenderFieldFn = (args: RenderFieldArgs) => ReactNode;

/** Props for the recursive controls that nest sub-fields. */
export interface RecursiveControlProps<
  F extends FormField = FormField,
> extends ControlProps<F> {
  renderField: RenderFieldFn;
}
