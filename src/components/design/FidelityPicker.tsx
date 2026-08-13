import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export function FidelityPicker({
  value,
  onChange,
}: {
  value?: 'wireframe' | 'high-fidelity';
  onChange: (value: 'wireframe' | 'high-fidelity') => void;
}) {
  const { t } = useLanguage();
  const options: Array<['wireframe' | 'high-fidelity', string]> = [
    ['wireframe', t.design.fidelity.wireframe],
    ['high-fidelity', t.design.fidelity.highFidelity],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={cn(
            'rounded-md border p-3 text-left text-sm',
            value === id ? 'border-primary bg-primary/10' : 'border-border',
          )}
          onClick={() => onChange(id)}
        >
          {id === 'wireframe' ? (
            <svg viewBox="0 0 120 64" className="mb-2 h-12 w-full">
              <rect
                x="8"
                y="8"
                width="104"
                height="48"
                rx="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M20 24h60M20 36h72M20 48h44"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 120 64" className="mb-2 h-12 w-full">
              <rect
                x="8"
                y="8"
                width="104"
                height="48"
                rx="6"
                fill="currentColor"
                opacity="0.08"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="M20 22h28M20 32h34M20 42h22"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <rect
                x="62"
                y="18"
                width="40"
                height="28"
                rx="3"
                fill="currentColor"
                opacity="0.35"
              />
              <path
                d="M68 38l8-8 6 6 4-4 10 10"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="74" cy="26" r="3" fill="currentColor" opacity="0.6" />
            </svg>
          )}
          <span className="font-medium">{label}</span>
        </button>
      ))}
    </div>
  );
}
