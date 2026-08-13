import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand, fonts } from '../../../theme';

const DOWNLOAD_LABEL = 'Download Free';

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoProgress = spring({
    frame,
    fps,
    config: { damping: 15 },
    durationInFrames: 30,
  });

  const urlProgress = spring({
    frame: frame - 30,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });

  const ctaProgress = spring({
    frame: frame - 50,
    fps,
    config: { damping: 12, stiffness: 180 },
    durationInFrames: 25,
  });

  const gradientShift = interpolate(frame, [0, 300], [0, 50]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(
          ellipse at 50% ${50 + gradientShift * 0.1}%,
          ${brand.colors.primary}15 0%,
          ${brand.colors.background} 60%
        )`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 30,
      }}
    >
      {/* Logo */}
      <div
        style={{
          opacity: logoProgress,
          transform: `scale(${interpolate(logoProgress, [0, 1], [0.8, 1])})`,
        }}
      >
        <Img
          src={staticFile('brand/app-icon.png')}
          style={{ width: 100, height: 100 }}
        />
      </div>

      {/* Product name */}
      <div
        style={{
          fontSize: 64,
          fontWeight: 800,
          fontFamily: fonts.heading,
          color: brand.colors.text,
          opacity: logoProgress,
          letterSpacing: -1,
        }}
      >
        {brand.name}
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 22,
          fontFamily: fonts.body,
          color: brand.colors.textMuted,
          opacity: urlProgress,
        }}
      >
        {brand.tagline}
      </div>

      {/* URL */}
      <div
        style={{
          fontSize: 28,
          fontWeight: 600,
          fontFamily: fonts.body,
          color: brand.colors.primary,
          opacity: urlProgress,
          letterSpacing: 1,
        }}
      >
        {brand.websiteDisplay}
      </div>

      {/* CTA button */}
      <div
        style={{
          opacity: ctaProgress,
          transform: `scale(${interpolate(ctaProgress, [0, 1], [0.9, 1])})`,
        }}
      >
        <div
          style={{
            background: brand.colors.primary,
            color: '#fff',
            padding: '16px 48px',
            borderRadius: 12,
            fontSize: 22,
            fontWeight: 700,
            fontFamily: fonts.body,
          }}
        >
          {DOWNLOAD_LABEL}
        </div>
      </div>
    </AbsoluteFill>
  );
};
