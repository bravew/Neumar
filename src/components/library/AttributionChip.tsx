import { ExternalLink } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { formatCloudStorageAttribution } from './cloudStorageAttribution';

export interface CloudStorageLicenseInfo {
  provider?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: {
    authorName: string;
    authorProfileUrl?: string;
    sourceName: string;
    sourceUrl?: string;
  };
  attributionText?: string;
  attributionUrl?: string;
  creatorName?: string;
  creatorUrl?: string;
  requiresAttribution?: boolean;
}

interface AttributionChipProps {
  licenseInfo?: CloudStorageLicenseInfo;
  className?: string;
}

export function AttributionChip({
  licenseInfo,
  className,
}: AttributionChipProps) {
  const { t, tt } = useLanguage();
  if (!licenseInfo) return null;

  const href =
    licenseInfo.attribution?.sourceUrl ??
    licenseInfo.attributionUrl ??
    licenseInfo.creatorUrl ??
    licenseInfo.licenseUrl;
  const label = formatCloudStorageAttribution(licenseInfo, t, tt);

  if (!label) return null;

  const content = (
    <>
      <span className="truncate">{label}</span>
      {licenseInfo.license ? (
        <span className="bg-background/80 shrink-0 rounded-sm px-1 py-0.5 font-mono uppercase">
          {licenseInfo.license}
        </span>
      ) : null}
      {href ? <ExternalLink className="size-3 shrink-0" aria-hidden /> : null}
    </>
  );

  const classes = cn(
    'border-border bg-muted text-muted-foreground inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs',
    className,
  );

  if (!href) {
    return <span className={classes}>{content}</span>;
  }

  return (
    <a
      className={cn(classes, 'hover:text-foreground')}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {content}
    </a>
  );
}
