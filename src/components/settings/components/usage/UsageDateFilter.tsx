import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type TimeRange = '24h' | '7d' | '30d' | 'all';

interface UsageDateFilterProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const RANGES: TimeRange[] = ['24h', '7d', '30d', 'all'];

export function getTimeRangeStart(range: TimeRange): string | undefined {
  if (range === 'all') return undefined;
  const now = new Date();
  const hours = range === '24h' ? 24 : range === '7d' ? 168 : 720;
  now.setHours(now.getHours() - hours);
  return now.toISOString();
}

export function UsageDateFilter({ value, onChange }: UsageDateFilterProps) {
  const { t } = useLanguage();

  const labels: Record<TimeRange, string> = {
    '24h': t.settings.usage24h,
    '7d': t.settings.usage7d,
    '30d': t.settings.usage30d,
    all: t.settings.usageAll,
  };

  return (
    <div className="bg-muted flex gap-1 rounded-lg p-0.5">
      {RANGES.map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === range
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labels[range]}
        </button>
      ))}
    </div>
  );
}
