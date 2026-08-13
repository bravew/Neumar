import type { ComponentType, SVGProps } from 'react';

import { CirclePlay, Cloud, Film, HardDrive } from 'lucide-react';
import { SiOpenverse, SiPexels, SiPixabay, SiUnsplash } from 'react-icons/si';

import BoxBrand from '@/assets/brands/box.svg?react';
import DropboxBrand from '@/assets/brands/dropbox.svg?react';
import GoogleDriveBrand from '@/assets/brands/google-drive.svg?react';
import ImmichBrand from '@/assets/brands/immich.svg?react';
import OneDriveBrand from '@/assets/brands/microsoft-onedrive.svg?react';
import PhotoPrismBrand from '@/assets/brands/photoprism.svg?react';
import { cn } from '@/shared/lib/utils';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface ProviderIconConfig {
  Icon: IconComponent;
  /** When true, the SVG paint is fixed (multi-color brand). currentColor overrides do nothing. */
  fixedColors: boolean;
  /** When fixedColors is false, use this fill via inline style.color. */
  monoColor?: string;
}

const PROVIDERS: Record<string, ProviderIconConfig> = {
  google_drive: { Icon: GoogleDriveBrand, fixedColors: true },
  dropbox: { Icon: DropboxBrand, fixedColors: true },
  box: { Icon: BoxBrand, fixedColors: true },
  onedrive: { Icon: OneDriveBrand, fixedColors: true },
  immich: { Icon: ImmichBrand, fixedColors: true },
  photoprism: { Icon: PhotoPrismBrand, fixedColors: true },
  s3_compatible: { Icon: HardDrive, fixedColors: false, monoColor: '#FF9900' },
  unsplash: { Icon: SiUnsplash, fixedColors: false },
  pexels: { Icon: SiPexels, fixedColors: false, monoColor: '#05A081' },
  openverse: { Icon: SiOpenverse, fixedColors: false, monoColor: '#FFE033' },
  // Simple-icons exposes Pixabay's official "P + leaf" mark with the
  // Pixabay brand green (#2EC66D); react-icons/si re-exports it.
  pixabay: { Icon: SiPixabay, fixedColors: false, monoColor: '#2EC66D' },
  // Coverr and Videvo don't have simple-icons entries; their brand marks
  // are dominated by a play glyph and a film glyph respectively, so we
  // approximate with lucide icons in each brand's primary color.
  coverr: { Icon: CirclePlay, fixedColors: false, monoColor: '#FF7F50' },
  videvo: { Icon: Film, fixedColors: false, monoColor: '#E91E63' },
};

const FALLBACK: ProviderIconConfig = { Icon: Cloud, fixedColors: false };

interface CloudProviderIconProps {
  provider: string;
  className?: string;
}

export function CloudProviderIcon({
  provider,
  className,
}: CloudProviderIconProps) {
  const config = PROVIDERS[provider] ?? FALLBACK;
  const { Icon, fixedColors, monoColor } = config;
  return (
    <Icon
      className={cn('size-4 shrink-0', className)}
      aria-hidden
      {...(fixedColors ? {} : monoColor ? { style: { color: monoColor } } : {})}
    />
  );
}
