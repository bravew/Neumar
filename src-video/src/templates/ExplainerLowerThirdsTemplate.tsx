import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { z } from 'zod';

import { brand, fonts } from '../theme';

export const explainerLowerThirdsTemplateSchema = z.object({
  topic: z.string().default('AI workflow automation'),
  expert: z.string().default('Host'),
  takeaway: z.string().default('A clear system beats scattered tools.'),
  brandColor: z.string().default(brand.colors.primary),
});

export const ExplainerLowerThirdsTemplate: React.FC<
  z.infer<typeof explainerLowerThirdsTemplateSchema>
> = ({ topic, expert, takeaway, brandColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 90 },
  });
  const lowerThirdY = interpolate(frame, [18, 36], [90, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const proofOpacity = interpolate(frame, [135, 165], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const takeawayOpacity = interpolate(frame, [960, 990], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #071111 0%, #101827 55%, ${brandColor} 160%)`,
        color: brand.colors.text,
        fontFamily: fonts.heading,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 72,
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 28,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 140,
          top: 150,
          width: 1120,
          transform: `scale(${0.92 + titleIn * 0.08})`,
          opacity: titleIn,
        }}
      >
        <div
          style={{
            color: brandColor,
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: 0,
            textTransform: 'uppercase',
          }}
        >
          Explainer
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: 0,
          }}
        >
          {topic}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 140,
          bottom: 120,
          width: 780,
          transform: `translateY(${lowerThirdY}px)`,
          borderRadius: 18,
          background: 'rgba(7,17,17,0.82)',
          border: `2px solid ${brandColor}`,
          padding: '26px 34px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 800 }}>{expert}</div>
        <div
          style={{
            marginTop: 8,
            color: brand.colors.textMuted,
            fontSize: 22,
            letterSpacing: 0,
          }}
        >
          Breaks down the practical impact
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 150,
          top: 230,
          display: 'grid',
          gap: 26,
          opacity: proofOpacity,
        }}
      >
        {['Problem', 'Pattern', 'Decision'].map((label, index) => (
          <div
            key={label}
            style={{
              width: 420,
              borderRadius: 20,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.16)',
              padding: 28,
              transform: `translateX(${Math.max(0, 60 - frame + 190 + index * 18)}px)`,
            }}
          >
            <div style={{ color: brandColor, fontSize: 20, fontWeight: 800 }}>
              0{index + 1}
            </div>
            <div style={{ marginTop: 10, fontSize: 34, fontWeight: 750 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 140,
          right: 140,
          bottom: 110,
          opacity: takeawayOpacity,
          fontSize: 56,
          lineHeight: 1.12,
          fontWeight: 800,
        }}
      >
        {takeaway}
      </div>
    </AbsoluteFill>
  );
};
