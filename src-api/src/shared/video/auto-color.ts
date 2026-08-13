import type { ProbeResult, StreamInfo } from '@/shared/services/ffmpeg';

export interface VideoColorMetadata {
  colorTransfer?: string;
  colorPrimaries?: string;
  colorSpace?: string;
  pixelFormat?: string;
}

export interface ColorManagementSummary {
  inputTransfer?: string;
  outputColorSpace: 'bt709';
  toneMapped: boolean;
}

const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const HDR_PRIMARIES = new Set(['bt2020']);
const HDR_COLOR_SPACES = new Set(['bt2020nc', 'bt2020c', 'bt2020_ncl']);

export const HDR_TO_SDR_FILTER =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
export const CONSERVATIVE_AUTO_COLOR_FILTER =
  'eq=contrast=1.1:brightness=0.02:saturation=1.05';

export function colorMetadataFromProbe(
  probe: ProbeResult,
): VideoColorMetadata | undefined {
  const video = probe.streams.find((stream) => stream.codecType === 'video');
  return colorMetadataFromStream(video);
}

export function colorMetadataFromStream(
  stream: StreamInfo | undefined,
): VideoColorMetadata | undefined {
  if (!stream) return undefined;
  const metadata: VideoColorMetadata = {
    colorTransfer: normalizeColorTag(stream.colorTransfer),
    colorPrimaries: normalizeColorTag(stream.colorPrimaries),
    colorSpace: normalizeColorTag(stream.colorSpace),
    pixelFormat: normalizeColorTag(stream.pixelFormat),
  };
  return Object.values(metadata).some(Boolean) ? metadata : undefined;
}

export function isHdrVideo(metadata: VideoColorMetadata | undefined): boolean {
  if (!metadata) return false;
  return (
    Boolean(
      metadata.colorTransfer && HDR_TRANSFERS.has(metadata.colorTransfer),
    ) ||
    Boolean(
      metadata.colorPrimaries && HDR_PRIMARIES.has(metadata.colorPrimaries),
    ) ||
    Boolean(metadata.colorSpace && HDR_COLOR_SPACES.has(metadata.colorSpace))
  );
}

export function buildVideoColorFilters(input: {
  color?: VideoColorMetadata;
  autoColorFilter?: string;
}): string[] {
  const filters: string[] = [];
  if (isHdrVideo(input.color)) filters.push(HDR_TO_SDR_FILTER);
  if (input.autoColorFilter) filters.push(input.autoColorFilter);
  return filters;
}

export function autoColorFilter(enabled: boolean): string | undefined {
  return enabled ? CONSERVATIVE_AUTO_COLOR_FILTER : undefined;
}

export function summarizeColorManagement(
  items: Array<{ color?: VideoColorMetadata }>,
): ColorManagementSummary | undefined {
  const hdrItem = items.find((item) => isHdrVideo(item.color));
  if (!hdrItem?.color) return undefined;
  return {
    inputTransfer: hdrItem.color.colorTransfer,
    outputColorSpace: 'bt709',
    toneMapped: true,
  };
}

function normalizeColorTag(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== 'unknown' ? normalized : undefined;
}
