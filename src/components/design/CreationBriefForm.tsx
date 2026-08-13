import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';

export function CreationBriefForm({
  initial,
  onSubmit,
}: {
  initial: Record<string, unknown>;
  onSubmit: (brief: Record<string, unknown>) => void;
}) {
  const { t, language } = useLanguage();
  const [audience, setAudience] = useState(String(initial.audience ?? ''));
  const [purpose, setPurpose] = useState(String(initial.purpose ?? ''));
  const [constraints, setConstraints] = useState(
    String(initial.constraints ?? ''),
  );
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          ...initial,
          audience,
          purpose,
          constraints,
          locale: language,
          chatLocale: language,
        });
      }}
    >
      <BriefInput
        label={t.design.audience}
        value={audience}
        onChange={setAudience}
      />
      <BriefInput
        label={t.design.purpose}
        value={purpose}
        onChange={setPurpose}
      />
      <label className="grid gap-1 text-sm">
        <span>{t.design.constraints}</span>
        <textarea
          value={constraints}
          onChange={(event) => setConstraints(event.target.value)}
          className="border-input min-h-20 rounded-md border p-2"
        />
      </label>
      <Button type="submit" size="sm" className="justify-self-start">
        {t.design.lockBrief}
      </Button>
    </form>
  );
}

function BriefInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-input h-9 rounded-md border px-2"
      />
    </label>
  );
}
