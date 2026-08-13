import { useState } from 'react';

import { Button } from '@/components/ui/button';

export interface QuestionField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox';
  required?: boolean;
  options?: QuestionOption[];
}

export type QuestionOption = string | { value: string; label?: string };

export function QuestionFormArtifact({
  title = 'A few details',
  fields,
  onSubmit,
}: {
  title?: string;
  fields: QuestionField[];
  onSubmit?: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [locked, setLocked] = useState(false);
  return (
    <form
      className="border-border bg-card space-y-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setLocked(true);
        onSubmit?.(answers);
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {locked && (
          <span className="bg-muted rounded px-2 py-1 text-xs">Answered</span>
        )}
      </div>
      {fields.map((field) => (
        <QuestionFieldControl
          key={field.name}
          field={field}
          value={answers[field.name] ?? ''}
          disabled={locked}
          onChange={(value) =>
            setAnswers((prev) => ({ ...prev, [field.name]: value }))
          }
        />
      ))}
      {!locked && (
        <Button type="submit" size="sm">
          Submit
        </Button>
      )}
    </form>
  );
}

function QuestionFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: QuestionField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const options = normalizeOptions(field.options);
  if (field.type === 'select' && options.length > 0) {
    return (
      <label className="block space-y-1 text-sm">
        <span>{field.label}</span>
        <select
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="border-input h-9 w-full rounded-md border px-2"
        >
          <option value="" />
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if ((field.type === 'radio' || field.type === 'checkbox') && options.length) {
    return (
      <fieldset className="space-y-1 text-sm">
        <legend>{field.label}</legend>
        <div className="space-y-1">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                disabled={disabled}
                type={field.type}
                checked={value === option.value}
                onChange={(event) => {
                  onChange(event.currentTarget.checked ? option.value : '');
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <label className="block space-y-1 text-sm">
      <span>{field.label}</span>
      {field.type === 'textarea' ? (
        <textarea
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="border-input w-full rounded-md border p-2"
        />
      ) : (
        <input
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="border-input h-9 w-full rounded-md border px-2"
        />
      )}
    </label>
  );
}

function normalizeOptions(options: QuestionOption[] | undefined) {
  return (options ?? []).map((option) =>
    typeof option === 'string'
      ? { value: option, label: option }
      : { value: option.value, label: option.label ?? option.value },
  );
}
