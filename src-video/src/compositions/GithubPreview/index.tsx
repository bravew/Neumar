import {
  AbsoluteFill,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand, fonts } from '../../theme';

/**
 * Short preview video/GIF for GitHub README.
 * 10 seconds at 720p — designed for autoplay.
 */
export const GithubPreview: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoProgress = spring({
    frame,
    fps,
    config: { damping: 15 },
    durationInFrames: 30,
  });

  const taglineProgress = spring({
    frame: frame - 25,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });

  const featuresProgress = spring({
    frame: frame - 90,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });

  const featureItems = [
    'Multi-Provider AI',
    'MCP Tools',
    'Automation',
    'Multi-Channel',
  ];

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${brand.colors.background} 0%, #1a1a2e 100%)`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 24,
        padding: '0 10%',
      }}
    >
      {/* Logo + Name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          opacity: logoProgress,
          transform: `scale(${interpolate(logoProgress, [0, 1], [0.8, 1])})`,
        }}
      >
        <Img
          src={staticFile('brand/app-icon.png')}
          style={{ width: 64, height: 64 }}
        />
        <div
          style={{
            fontSize: 48,
            fontWeight: 800,
            fontFamily: fonts.heading,
            color: brand.colors.text,
          }}
        >
          {brand.name}
        </div>
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 22,
          fontFamily: fonts.body,
          color: brand.colors.textMuted,
          opacity: taglineProgress,
          transform: `translateY(${interpolate(taglineProgress, [0, 1], [15, 0])}px)`,
        }}
      >
        {brand.tagline}
      </div>

      {/* Feature badges */}
      <Sequence from={90}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
            opacity: featuresProgress,
          }}
        >
          {featureItems.map((item, i) => {
            const badgeProgress = spring({
              frame: frame - 90 - i * 8,
              fps,
              config: { damping: 15 },
              durationInFrames: 20,
            });

            return (
              <div
                key={item}
                style={{
                  background: `${brand.colors.primary}20`,
                  border: `1px solid ${brand.colors.primary}40`,
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: 16,
                  fontFamily: fonts.body,
                  color: brand.colors.primaryDark,
                  fontWeight: 600,
                  opacity: badgeProgress,
                  transform: `scale(${interpolate(badgeProgress, [0, 1], [0.8, 1])})`,
                }}
              >
                {item}
              </div>
            );
          })}
        </div>
      </Sequence>

      {/* URL */}
      <Sequence from={150}>
        <div
          style={{
            fontSize: 18,
            fontFamily: fonts.body,
            color: brand.colors.primary,
            fontWeight: 600,
            opacity: interpolate(frame - 150, [0, 20], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {brand.websiteDisplay}
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
