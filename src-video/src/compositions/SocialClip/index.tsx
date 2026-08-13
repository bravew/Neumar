import { TransitionSeries } from '@remotion/transitions';
import { AbsoluteFill, useVideoConfig } from 'remotion';

import { BrandWatermark } from '../../components/BrandWatermark';
import { DeviceFrame } from '../../components/DeviceFrame';
import { TextOverlay } from '../../components/TextOverlay';
import { transitions } from '../../components/TransitionPresets';
import { brand } from '../../theme';

/**
 * Multi-format social clip adapter.
 * Layout adapts based on composition dimensions:
 * - 1080x1080 -> square (Twitter, Instagram)
 * - 1080x1920 -> vertical (TikTok, Reels)
 * - 1920x1080 -> landscape (YouTube, LinkedIn)
 */
export const SocialClip: React.FC = () => {
  const { width, height } = useVideoConfig();
  const isVertical = height > width;

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <TransitionSeries>
        {/* Hook — 2s */}
        <TransitionSeries.Sequence durationInFrames={60}>
          <AbsoluteFill
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <TextOverlay
              text="AI agents, one desktop app"
              fontSize={isVertical ? 42 : 56}
              entrance="scale"
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.slideUp} />

        {/* App showcase — 8s */}
        <TransitionSeries.Sequence durationInFrames={240}>
          <AbsoluteFill>
            <div
              style={{
                padding: isVertical ? '20% 5%' : '5% 10%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <DeviceFrame
                screenshot="home-with-tasks.png"
                type={isVertical ? 'mobile' : 'desktop'}
              />
            </div>
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.crossfade} />

        {/* CTA — 3s */}
        <TransitionSeries.Sequence durationInFrames={90}>
          <AbsoluteFill
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 20,
            }}
          >
            <TextOverlay text={brand.name} fontSize={64} entrance="scale" />
            <TextOverlay
              text={brand.websiteDisplay}
              fontSize={28}
              color={brand.colors.primary}
              entrance="fade"
              delay={15}
              y={60}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>
      </TransitionSeries>

      <BrandWatermark size={isVertical ? 30 : 40} />
    </AbsoluteFill>
  );
};
