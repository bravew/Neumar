import type { AspectRatio, MediaItem, VideoProject } from './types';

/**
 * Pre-flight aspect analysis: compares every image/video asset's aspect ratio
 * against the target canvas BEFORE building/rendering, so the agent can pick a
 * sensible fit (cover / contain / Ken Burns pan) and STOP to ask the user when
 * an asset cannot fill the canvas without losing meaningful content — instead of
 * silently cropping, letterboxing, or stretching. Works from metadata only (no
 * download): catalog/cloud assets carry width/height at attach time.
 */

export type AspectFit = 'cover' | 'contain' | 'pan' | 'blur-pad' | 'ask';

// How an asset's place in the suggested sequence was decided, strongest to
// weakest: capture time, a timestamp in the filename, a sequence number in the
// filename (IMG_0001…), or a plain natural-sort of the name as a last resort.
export type OrderBasis =
  | 'captured-at'
  | 'filename'
  | 'filename-sequence'
  | 'name'
  | 'none';

export interface AssetAspectAnalysis {
  assetId: string;
  name?: string;
  kind: MediaItem['kind'];
  width?: number;
  height?: number;
  aspect?: number;
  aspectLabel?: string;
  orientation?: 'landscape' | 'portrait' | 'square';
  cropLossPct?: number;
  fit: AspectFit;
  needsDecision: boolean;
  reason: string;
  /** Capture time (ISO) when known, for chronological ordering. */
  capturedAt?: string;
  /** Where `capturedAt`/order came from: metadata, the filename, or nothing. */
  orderBasis: OrderBasis;
  /** Capture location (decimal degrees) when known, for location grouping. */
  gps?: { lat: number; lng: number };
  /**
   * Heuristic: this looks like a brand logo / wordmark (square or
   * alpha graphic, or a logo-ish filename). Such assets usually belong as an
   * opening/closing title card or bookend, not inline in capture order.
   */
  isLikelyLogo?: boolean;
}

export interface ProjectAspectAnalysis {
  targetAspect: AspectRatio;
  targetRatio: number;
  decisionsNeeded: number;
  assets: AssetAspectAnalysis[];
  /**
   * Asset ids in a best-effort suggested sequence, degrading from capture time
   * → filename timestamp → filename sequence number → natural name sort, so a
   * sequence is proposed even without EXIF. Per-asset `orderBasis` says how the
   * order was derived (and thus how trustworthy it is). Present whenever there
   * are at least two image/video assets to order.
   */
  suggestedOrder?: string[];
  /**
   * Asset ids that look like brand logos/wordmarks — candidates to place as
   * an intro/outro title or bookend rather than inline in the montage.
   */
  logoAssetIds?: string[];
}

const TARGET_RATIO: Record<AspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
};

const MATCH_TOLERANCE = 0.08; // <=8% crop reads as a clean match
const HEAVY_CROP = 0.3; // >30% of the source cropped → ask the user

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectLabel(width: number, height: number): string {
  const divisor = gcd(width, height) || 1;
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  // Keep tiny reductions; fall back to decimal for ugly ratios.
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}

function orientationOf(aspect: number): 'landscape' | 'portrait' | 'square' {
  if (aspect > 1.05) return 'landscape';
  if (aspect < 0.95) return 'portrait';
  return 'square';
}

// Ordering fields (`capturedAt`/`orderBasis`) are layered on by
// `analyzeProjectAssets`, which has the whole-set context needed to sort.
type AssetFitAnalysis = Omit<
  AssetAspectAnalysis,
  'capturedAt' | 'orderBasis' | 'gps' | 'isLikelyLogo'
>;

const LOGO_NAME =
  /(^|[\s._-])(logo|wordmark|brandmark|emblem|lockup)(?=$|[\s._-])/i;

// A brand logo/wordmark, heuristically: an image whose name says so, or a
// transparent/square graphic that would read as a mark rather than a photo.
// Used to recommend an intro/outro placement instead of inline montage order.
function isLikelyLogo(asset: MediaItem): boolean {
  if (asset.kind !== 'image') return false;
  const name = asset.provenance?.sourceDisplayName ?? asset.path;
  if (LOGO_NAME.test(name)) return true;
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const hasAlpha = ext === '.png' || ext === '.svg' || ext === '.webp';
  const { width, height } = asset.metadata;
  const square = !!width && !!height && Math.abs(width / height - 1) <= 0.1;
  return hasAlpha && square;
}

function analyzeAsset(
  asset: MediaItem,
  targetRatio: number,
  targetAspect: AspectRatio,
): AssetFitAnalysis {
  const base = {
    assetId: asset.id,
    name: asset.provenance?.sourceDisplayName,
    kind: asset.kind,
  };
  const width = asset.metadata.width;
  const height = asset.metadata.height;
  if (!width || !height) {
    return {
      ...base,
      fit: 'ask',
      needsDecision: true,
      reason:
        'Dimensions unknown — inspect/hydrate the asset before choosing a fit.',
    };
  }

  const aspect = width / height;
  const orientation = orientationOf(aspect);
  const cropLoss =
    1 - Math.min(aspect, targetRatio) / Math.max(aspect, targetRatio);
  const cropLossPct = Math.round(cropLoss * 100);
  const targetOrientation = orientationOf(targetRatio);
  const orientationFlip =
    orientation !== 'square' &&
    targetOrientation !== 'square' &&
    orientation !== targetOrientation;

  const common = {
    ...base,
    width,
    height,
    aspect: Number(aspect.toFixed(4)),
    aspectLabel: aspectLabel(width, height),
    orientation,
    cropLossPct,
  };

  if (cropLoss <= MATCH_TOLERANCE) {
    return {
      ...common,
      fit: 'cover',
      needsDecision: false,
      reason: `Aspect ~matches ${targetAspect}; cover-fit is clean.`,
    };
  }

  if (orientation === 'square' && targetAspect !== '1:1') {
    return {
      ...common,
      fit: 'blur-pad',
      needsDecision: true,
      reason: `Square asset (often a logo/graphic) on ${targetAspect}: cover-crop would cut its edges. Recommend blur-pad (whole asset over a blurred backdrop). Confirm blur-pad vs letterbox/contain (black bars) vs crop.`,
    };
  }

  if (orientationFlip || cropLoss > HEAVY_CROP) {
    return {
      ...common,
      fit: 'ask',
      needsDecision: true,
      reason: `${orientation} asset on ${targetAspect} would crop ~${cropLossPct}% under cover${orientationFlip ? ' (orientation flip)' : ''}. Ask the user: crop with a chosen focus, blur-pad (whole asset over a blurred backdrop), letterbox/contain, or pan within a safe region.`,
    };
  }

  return {
    ...common,
    fit: asset.kind === 'image' ? 'pan' : 'cover',
    needsDecision: false,
    reason: `Minor mismatch (~${cropLossPct}% crop); ${asset.kind === 'image' ? 'Ken Burns pan within a safe sub-region' : 'cover-reframe'} is acceptable.`,
  };
}

export function analyzeProjectAssets(
  project: VideoProject,
  targetAspect: AspectRatio,
): ProjectAspectAnalysis {
  const targetRatio = TARGET_RATIO[targetAspect];
  const source = project.assets.filter(
    (asset) => asset.kind === 'image' || asset.kind === 'video',
  );
  const assets = source.map((asset, index) => {
    const analysis = analyzeAsset(asset, targetRatio, targetAspect);
    const order = assetOrderKey(asset);
    return {
      ...analysis,
      capturedAt: order.iso,
      orderBasis: order.basis,
      gps: asset.metadata.gps,
      isLikelyLogo: isLikelyLogo(asset) || undefined,
      _orderMs: order.ms,
      _name: order.name,
      _index: index,
    };
  });

  const logoAssetIds = assets
    .filter((a) => a.isLikelyLogo)
    .map((a) => a.assetId);

  // Always propose a best-effort sequence when there's more than one asset.
  // The comparator degrades gracefully: capture/filename time first, then a
  // natural (numeric-aware) filename sort so IMG_0001 < IMG_0002 < IMG_0010 and
  // clip2 < clip10. Assets with no timestamp sort after timed ones (Infinity
  // key) but are still placed in a sensible name order rather than dropped.
  const suggestedOrder =
    assets.length >= 2
      ? [...assets]
          .sort(
            (a, b) =>
              // Guard equal keys: Infinity - Infinity is NaN (both untimed),
              // which would corrupt the sort.
              (a._orderMs === b._orderMs ? 0 : a._orderMs - b._orderMs) ||
              a._name.localeCompare(b._name, undefined, {
                numeric: true,
                sensitivity: 'base',
              }) ||
              a._index - b._index,
          )
          .map((a) => a.assetId)
      : undefined;

  return {
    targetAspect,
    targetRatio: Number(targetRatio.toFixed(4)),
    decisionsNeeded: assets.filter((a) => a.needsDecision).length,
    // Strip the internal sort scratch fields from the public payload.
    assets: assets.map(({ _orderMs, _name, _index, ...rest }) => rest),
    suggestedOrder,
    logoAssetIds: logoAssetIds.length > 0 ? logoAssetIds : undefined,
  };
}

interface AssetOrderKey {
  /** Sortable time; POSITIVE_INFINITY when no timestamp could be derived. */
  ms: number;
  /** ISO form of a derived timestamp, for display; undefined when none. */
  iso?: string;
  /** Filename basename used for the natural-sort tiebreak / last resort. */
  name: string;
  basis: OrderBasis;
}

// Best-effort ordering key. Tiered, strongest to weakest, so we can always
// propose *some* sequence even with no capture metadata:
//   1. stored capture date (EXIF/creation_time/catalog)  → 'captured-at'
//   2. a timestamp embedded in the filename              → 'filename'
//   3. a number in the filename (IMG_0001, clip-2, …)    → 'filename-sequence'
//   4. plain natural-sorted name                          → 'name'
function assetOrderKey(asset: MediaItem): AssetOrderKey {
  const rawName = asset.provenance?.sourceDisplayName ?? asset.path;
  const name = rawName.split(/[\\/]/).pop() ?? rawName;

  const captured = asset.metadata.capturedAt;
  if (captured) {
    const ms = Date.parse(captured);
    if (!Number.isNaN(ms)) {
      return {
        ms,
        iso: new Date(ms).toISOString(),
        name,
        basis: 'captured-at',
      };
    }
  }

  const fromName = parseFilenameTimestampMs(name);
  if (fromName !== undefined) {
    return {
      ms: fromName,
      iso: new Date(fromName).toISOString(),
      name,
      basis: 'filename',
    };
  }

  // No timestamp: keep ms at Infinity so timed assets sort first, and let the
  // natural-sort tiebreak place this one. A digit in the name *stem* (ignoring
  // the extension, since `.mp4`/`.mp3` carry digits) signals an explicit
  // sequence number (IMG_0001) vs. an arbitrary label.
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return {
    ms: Number.POSITIVE_INFINITY,
    name,
    basis: /\d/.test(stem) ? 'filename-sequence' : 'name',
  };
}

const FILENAME_DATETIME = /(\d{4})(\d{2})(\d{2})[ _T-]?(\d{2})(\d{2})(\d{2})/;
const FILENAME_DATE = /(\d{4})(\d{2})(\d{2})/;

function parseFilenameTimestampMs(name: string): number | undefined {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dt = FILENAME_DATETIME.exec(base);
  if (dt) {
    const [, y, mo, d, h, mi, s] = dt.map(Number);
    return validUtcMs(y, mo, d, h, mi, s);
  }
  const dOnly = FILENAME_DATE.exec(base);
  if (dOnly) {
    const [, y, mo, d] = dOnly.map(Number);
    return validUtcMs(y, mo, d, 0, 0, 0);
  }
  return undefined;
}

function validUtcMs(
  y: number | undefined,
  mo: number | undefined,
  d: number | undefined,
  h: number | undefined,
  mi: number | undefined,
  s: number | undefined,
): number | undefined {
  if (
    y === undefined ||
    mo === undefined ||
    d === undefined ||
    h === undefined ||
    mi === undefined ||
    s === undefined
  ) {
    return undefined;
  }
  if (y < 1990 || y > 2100) return undefined;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  if (h > 23 || mi > 59 || s > 59) return undefined;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  // Reject rollovers (e.g. month 02 day 31 → March): the round-trip must match.
  const back = new Date(ms);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
    return undefined;
  return ms;
}
