import sharp from 'sharp';

export type ClipGradeIntent =
  | 'neutral'
  | 'warmer'
  | 'cooler'
  | 'less-contrasty';

export interface ClipGradeAnalysis {
  schema: 'neuma.video.clip-grade-analysis.v1';
  measurements: {
    luminance: number;
    contrast: number;
    redBlueBalance: number;
  };
  correction: {
    brightness: number;
    contrast: number;
    temperature: number;
  };
}

export async function analyzeClipGradeImage(
  imageBase64: string,
  intent: ClipGradeIntent = 'neutral',
): Promise<ClipGradeAnalysis> {
  const stats = await sharp(Buffer.from(imageBase64, 'base64')).stats();
  const [red, green, blue] = stats.channels;
  if (!red || !green || !blue) {
    throw new Error('Rendered frame does not contain RGB channels');
  }
  const luminance =
    (0.2126 * red.mean + 0.7152 * green.mean + 0.0722 * blue.mean) / 255;
  const contrast = (red.stdev + green.stdev + blue.stdev) / (3 * 128);
  const redBlueBalance = (red.mean - blue.mean) / 255;
  const intentTemperature =
    intent === 'warmer' ? 0.12 : intent === 'cooler' ? -0.12 : 0;

  return {
    schema: 'neuma.video.clip-grade-analysis.v1',
    measurements: { luminance, contrast, redBlueBalance },
    correction: {
      brightness: clamp((0.5 - luminance) * 0.6, -0.25, 0.25),
      contrast:
        intent === 'less-contrasty'
          ? Math.min(0.9, clamp(1 + (0.18 - contrast) * 0.5, 0.85, 1.15))
          : clamp(1 + (0.18 - contrast) * 0.5, 0.85, 1.15),
      temperature: clamp(intentTemperature - redBlueBalance * 0.5, -0.25, 0.25),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
