import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand, fonts } from '../../../theme';

const features = [
  {
    icon: 'AI',
    title: 'Multi-Provider AI',
    subtitle: 'Claude, GPT, Gemini, DeepSeek',
    color: '#7C3AED',
  },
  {
    icon: 'MCP',
    title: 'MCP Tool Ecosystem',
    subtitle: 'Connect any tool via protocol',
    color: '#059669',
  },
  {
    icon: 'Auto',
    title: 'Automation & Scheduling',
    subtitle: 'Cron, webhooks, heartbeat',
    color: '#D97706',
  },
  {
    icon: 'Chat',
    title: 'Multi-Channel Delivery',
    subtitle: 'Telegram, Slack, Discord',
    color: '#2563EB',
  },
  {
    icon: 'Proj',
    title: 'Project Workspaces',
    subtitle: 'Organized context per project',
    color: '#DC2626',
  },
];

const FRAMES_PER_FEATURE = 108; // 3.6s each

export const FeaturesMontageScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentFeatureIndex = Math.min(
    Math.floor(frame / FRAMES_PER_FEATURE),
    features.length - 1,
  );
  const featureFrame = frame - currentFeatureIndex * FRAMES_PER_FEATURE;

  const feature = features[currentFeatureIndex];

  const entrance = spring({
    frame: featureFrame,
    fps,
    config: { damping: 15, stiffness: 200 },
    durationInFrames: 20,
  });

  const exit =
    featureFrame > FRAMES_PER_FEATURE - 15
      ? interpolate(
          featureFrame,
          [FRAMES_PER_FEATURE - 15, FRAMES_PER_FEATURE],
          [1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
      : 1;

  const opacity = entrance * exit;
  const translateY = interpolate(entrance, [0, 1], [40, 0]);

  // Progress dots
  const dotsOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.background,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 40,
      }}
    >
      {/* Feature card */}
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <div
          style={{
            width: 100,
            height: 100,
            borderRadius: 24,
            background: `${feature.color}20`,
            border: `2px solid ${feature.color}40`,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontSize: 32,
            fontWeight: 800,
            fontFamily: fonts.mono,
            color: feature.color,
          }}
        >
          {feature.icon}
        </div>

        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            fontFamily: fonts.heading,
            color: brand.colors.text,
            textAlign: 'center',
          }}
        >
          {feature.title}
        </div>

        <div
          style={{
            fontSize: 24,
            fontFamily: fonts.body,
            color: brand.colors.textMuted,
            textAlign: 'center',
          }}
        >
          {feature.subtitle}
        </div>
      </div>

      {/* Progress dots */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          opacity: dotsOpacity,
        }}
      >
        {features.map((_, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background:
                i === currentFeatureIndex
                  ? brand.colors.text
                  : brand.colors.surfaceBorder,
              transition: 'none',
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
