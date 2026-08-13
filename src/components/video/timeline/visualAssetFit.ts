import type {
  VideoAspectRatio,
  VideoClipTransform,
  VideoMediaItem,
  VideoProject,
} from '@/shared/types/video';

const ASPECT_RATIO_VALUE: Record<VideoAspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
};
const MATCH_TOLERANCE = 0.08;
const HEAVY_CROP = 0.3;
const LOGO_NAME =
  /(^|[\s._-])(logo|wordmark|brandmark|emblem|lockup)(?=$|[\s._-])/i;
const ALPHA_GRAPHIC_EXTENSION = /\.(png|svg|webp)$/i;
const LOGO_BACKGROUND = '#ffffff';

export function targetAspectRatioForProject(
  project: VideoProject,
): VideoAspectRatio {
  return (
    project.settings?.defaultAspectRatios?.[0] ??
    project.outputs?.[0]?.aspectRatio ??
    '16:9'
  );
}

export function inferDefaultVisualAssetTransform(
  asset: VideoMediaItem,
  aspectRatio: VideoAspectRatio,
): VideoClipTransform | undefined {
  if (asset.kind !== 'image' && asset.kind !== 'video') return undefined;
  const likelyLogo = isLikelyLogo(asset);
  if (likelyLogo) {
    return { fit: 'contain', background: LOGO_BACKGROUND };
  }

  const { width, height } = asset.metadata;
  if (!width || !height) return undefined;

  const targetAspect = ASPECT_RATIO_VALUE[aspectRatio];
  const sourceAspect = width / height;
  const cropLoss =
    1 -
    Math.min(sourceAspect, targetAspect) / Math.max(sourceAspect, targetAspect);
  if (cropLoss <= MATCH_TOLERANCE) return undefined;

  const sourceOrientation = orientationOf(sourceAspect);
  const targetOrientation = orientationOf(targetAspect);
  const orientationFlip =
    sourceOrientation !== 'square' &&
    targetOrientation !== 'square' &&
    sourceOrientation !== targetOrientation;
  if (
    (sourceOrientation === 'square' && aspectRatio !== '1:1') ||
    orientationFlip ||
    cropLoss > HEAVY_CROP
  ) {
    return { fit: 'blur-pad' };
  }

  return undefined;
}

function isLikelyLogo(asset: VideoMediaItem): boolean {
  if (asset.kind !== 'image') return false;
  const name = asset.provenance?.sourceDisplayName ?? asset.path;
  if (LOGO_NAME.test(name)) return true;
  const { width, height } = asset.metadata;
  const square = Boolean(
    width && height && Math.abs(width / height - 1) <= 0.1,
  );
  return square && ALPHA_GRAPHIC_EXTENSION.test(name);
}

function orientationOf(aspect: number): 'landscape' | 'portrait' | 'square' {
  if (aspect > 1.05) return 'landscape';
  if (aspect < 0.95) return 'portrait';
  return 'square';
}
