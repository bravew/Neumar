import { useLanguage } from '@/shared/providers/language-provider';
import type { FormField } from '@/shared/video/useFormSpec';

import { ControlAssetPicker } from './ControlAssetPicker';
import { ControlDate } from './ControlDate';
import { ControlFieldset } from './ControlFieldset';
import { ControlNumber } from './ControlNumber';
import { ControlSelect } from './ControlSelect';
import { ControlTable } from './ControlTable';
import { ControlTagList } from './ControlTagList';
import { ControlText, ControlTextarea } from './ControlText';
import { ControlToggle } from './ControlToggle';
import type { RenderFieldArgs } from './types';

// Slice K follow-up — the field dispatcher, extracted from VariableForm so the
// recursive controls (fieldset / table) can be handed `renderField` without an
// import cycle. Every FormField kind is now wired; `default` is a guard for
// future/unknown kinds.

export function renderField({
  field,
  value,
  onChange,
  disabled,
}: RenderFieldArgs) {
  switch (field.kind) {
    case 'text':
      return (
        <ControlText
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'textarea':
      return (
        <ControlTextarea
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'select':
      return (
        <ControlSelect
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'number':
      return (
        <ControlNumber
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'toggle':
      return (
        <ControlToggle
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'date':
      return (
        <ControlDate
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'tagList':
      return (
        <ControlTagList
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'assetPicker':
      return (
        <ControlAssetPicker
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'fieldset':
      return (
        <ControlFieldset
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          renderField={renderField}
        />
      );
    case 'table':
      return (
        <ControlTable
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled}
          renderField={renderField}
        />
      );
    default:
      return <UnsupportedControl field={field} />;
  }
}

function UnsupportedControl({ field }: { field: FormField }) {
  const { t } = useLanguage();
  return (
    <div
      className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
      data-testid={`unsupported-${field.kind}-${field.key}`}
    >
      {t.video.htmlGallery.unsupportedControl
        .replace('{label}', field.label)
        .replace('{kind}', field.kind)}
    </div>
  );
}
