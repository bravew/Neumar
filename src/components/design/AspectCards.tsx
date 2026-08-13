import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const ASPECTS = [
  { id: '1:1', labelKey: 'square', box: 'aspect-square w-8' },
  { id: '16:9', labelKey: 'landscape', box: 'aspect-video w-10' },
  { id: '9:16', labelKey: 'portrait', box: 'aspect-[9/16] w-6' },
  { id: '4:3', labelKey: 'wide', box: 'aspect-[4/3] w-9' },
  { id: '3:4', labelKey: 'tall', box: 'aspect-[3/4] w-7' },
] as const;

export function AspectCards({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label={t.creative.mediaGeneration.aspectRatio}
    >
      {ASPECTS.map((aspect) => (
        <button
          key={aspect.id}
          type="button"
          aria-pressed={value === aspect.id}
          className={cn(
            'flex h-10 items-center gap-2 rounded-md border px-3 text-xs',
            value === aspect.id
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background hover:bg-accent',
          )}
          onClick={() => onChange(aspect.id)}
        >
          <span
            className={cn('rounded-sm border-2 border-current', aspect.box)}
          />
          <span>{aspect.id}</span>
          <span className="text-muted-foreground hidden md:inline">
            {t.design.aspect[aspect.labelKey]}
          </span>
        </button>
      ))}
    </div>
  );
}
