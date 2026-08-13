import { TransitionSeries } from '@remotion/transitions';
import { AbsoluteFill, Sequence } from 'remotion';

import { z } from 'zod';

import { BrandWatermark } from '../../components/BrandWatermark';
import { DeviceFrame } from '../../components/DeviceFrame';
import { TextOverlay } from '../../components/TextOverlay';
import { transitions } from '../../components/TransitionPresets';
import { brand } from '../../theme';

export const featureClipSchema = z.object({
  featureId: z.string(),
  title: z.string(),
  description: z.string(),
  screenshot: z.string().optional(),
  highlights: z
    .array(
      z.object({
        text: z.string(),
        x: z.number(),
        y: z.number(),
      }),
    )
    .optional(),
});

type FeatureClipProps = z.infer<typeof featureClipSchema>;

export const FeatureClip: React.FC<FeatureClipProps> = ({
  title,
  description,
  screenshot,
  highlights,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <TransitionSeries>
        {/* Feature title card — 3s */}
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
            <TextOverlay text={title} fontSize={56} entrance="scale" />
            <TextOverlay
              text={description}
              fontSize={24}
              color={brand.colors.textMuted}
              entrance="fade"
              delay={20}
              y={58}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.slideRight} />

        {/* Screenshot with annotations — 20s */}
        <TransitionSeries.Sequence durationInFrames={600}>
          <AbsoluteFill>
            {screenshot && (
              <div style={{ padding: '5% 10%' }}>
                <DeviceFrame screenshot={screenshot} type="desktop" />
              </div>
            )}
            {highlights?.map((h, i) => (
              <Sequence key={h.text} from={30 + i * 20}>
                <div
                  style={{
                    position: 'absolute',
                    left: `${h.x}%`,
                    top: `${h.y}%`,
                  }}
                >
                  <TextOverlay
                    text={h.text}
                    fontSize={18}
                    entrance="slide-up"
                    color={brand.colors.primary}
                  />
                </div>
              </Sequence>
            ))}
          </AbsoluteFill>
        </TransitionSeries.Sequence>
      </TransitionSeries>

      <BrandWatermark />
    </AbsoluteFill>
  );
};
