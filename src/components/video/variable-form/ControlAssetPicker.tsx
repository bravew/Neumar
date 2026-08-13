import { useLanguage } from '@/shared/providers/language-provider';
import type { FormField } from '@/shared/video/useFormSpec';

import { FieldShell } from './FieldShell';
import type { ControlProps } from './types';

type AssetPickerField = Extract<FormField, { kind: 'assetPicker' }>;

// Follow-up to Slice K — assetPicker control. v1: a reference input (asset
// path / catalog id) hinted by the expected asset kind. A modal media-library
// picker bound to the project assets is a later enhancement.

export function ControlAssetPicker({
  field,
  value,
  onChange,
  disabled,
}: ControlProps<AssetPickerField>) {
  const { t } = useLanguage();
  const stringValue = typeof value === 'string' ? value : '';
  const placeholder = t.video.htmlGallery.assetPlaceholder.replace(
    '{kind}',
    field.assetKind,
  );
  return (
    <FieldShell field={field}>
      <input
        type="text"
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        value={stringValue}
        placeholder={placeholder}
        required={field.required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={field.label}
      />
    </FieldShell>
  );
}
