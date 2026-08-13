import type { DesignProjectIntent } from '@/shared/types/design-mode';

const INTENT_OPTIONS: DesignProjectIntent[] = [
  'landing-page',
  'app-screen',
  'os-widget',
  'live-artifact',
  'slide',
  'media',
  'other',
];

export function ProjectIntentPicker({
  value,
  labels,
  onChange,
}: {
  value: DesignProjectIntent;
  labels: Record<string, string>;
  onChange: (value: DesignProjectIntent) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{labels.intent}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {INTENT_OPTIONS.map((intent) => (
          <button
            key={intent}
            type="button"
            className="data-[active=true]:border-primary data-[active=true]:bg-primary/10 rounded-md border px-3 py-2 text-left text-sm"
            data-active={value === intent}
            onClick={() => onChange(intent)}
          >
            {labels[intent] ?? intent}
          </button>
        ))}
      </div>
    </div>
  );
}
