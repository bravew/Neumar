import { Check } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type StockLicenseCode =
  | 'cc0'
  | 'cc-by'
  | 'cc-by-sa'
  | 'cc-by-nc'
  | 'public-domain'
  | 'unsplash'
  | 'pexels'
  | 'pixabay';

interface LicenseFilterProps {
  value: StockLicenseCode[];
  onChange: (value: StockLicenseCode[]) => void;
  options?: StockLicenseCode[];
  className?: string;
}

const DEFAULT_LICENSE_OPTIONS: StockLicenseCode[] = [
  'cc0',
  'cc-by',
  'public-domain',
  'unsplash',
  'pexels',
];

export function LicenseFilter({
  value,
  onChange,
  options = DEFAULT_LICENSE_OPTIONS,
  className,
}: LicenseFilterProps) {
  const { t } = useLanguage();

  const labels: Record<StockLicenseCode, string> = {
    cc0: t.cloudStorage.licenseCc0,
    'cc-by': t.cloudStorage.licenseCcBy,
    'cc-by-sa': t.cloudStorage.licenseCcBySa,
    'cc-by-nc': t.cloudStorage.licenseCcByNc,
    'public-domain': t.cloudStorage.licensePublicDomain,
    unsplash: t.cloudStorage.licenseUnsplash,
    pexels: t.cloudStorage.licensePexels,
    pixabay: t.cloudStorage.licensePixabay,
  };

  function toggleLicense(license: StockLicenseCode) {
    if (value.includes(license)) {
      onChange(value.filter((item) => item !== license));
      return;
    }
    onChange([...value, license]);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="text-muted-foreground text-xs font-medium">
        {t.cloudStorage.licenseFilterLabel}
      </span>
      {options.map((license) => {
        const selected = value.includes(license);
        return (
          <button
            key={license}
            type="button"
            aria-pressed={selected}
            onClick={() => toggleLicense(license)}
            className={cn(
              'border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors',
              selected && 'border-primary bg-primary/10 text-primary',
            )}
          >
            {selected ? <Check className="size-3" aria-hidden /> : null}
            {labels[license]}
          </button>
        );
      })}
    </div>
  );
}
