import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';

import { z } from 'zod';

import { BrandWatermark } from '../../components/BrandWatermark';
import { ScreenRecordingScene } from '../../scenes/ScreenRecordingScene';
import { brand, fonts } from '../../theme';

const cameraZoomSchema = z.object({
  label: z.string(),
  targetX: z.number(),
  targetY: z.number(),
  zoomLevel: z.number(),
  fromMs: z.number(),
  durationMs: z.number(),
  holdMs: z.number().optional(),
});

export const docDemoSchema = z.object({
  id: z.string(),
  title: z.string(),
  recordingPath: z.string(),
  durationMs: z.number(),
  fps: z.number(),
  camera: z.object({
    fps: z.number(),
    durationMs: z.number().optional(),
    sourceStartMs: z.number().optional(),
    zooms: z.array(cameraZoomSchema),
  }),
  steps: z.array(z.string()).default([]),
});

type DocDemoProps = z.infer<typeof docDemoSchema>;

function msToFrames(ms: number, fps: number) {
  return Math.round((ms / 1000) * fps);
}

export const DocDemo: React.FC<DocDemoProps> = ({
  title,
  recordingPath,
  camera,
  steps,
}) => {
  const { fps } = useVideoConfig();
  const sourceStartFrame = msToFrames(camera.sourceStartMs ?? 0, fps);
  const zooms = camera.zooms.map((zoom) => ({
    targetX: zoom.targetX,
    targetY: zoom.targetY,
    zoomLevel: zoom.zoomLevel,
    fromFrame: msToFrames(zoom.fromMs, fps),
    durationInFrames: msToFrames(zoom.durationMs, fps),
    holdFrames: zoom.holdMs ? msToFrames(zoom.holdMs, fps) : undefined,
  }));

  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <ScreenRecordingScene
        recording={recordingPath}
        zooms={zooms}
        startFrom={sourceStartFrame}
      />

      <Sequence from={12} durationInFrames={72}>
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: 72,
            maxWidth: 520,
            color: brand.colors.text,
            fontFamily: fonts.heading,
            fontSize: 34,
            fontWeight: 700,
            lineHeight: 1.15,
            textShadow: '0 2px 18px rgb(0 0 0 / 0.45)',
          }}
        >
          {title}
        </div>
      </Sequence>

      {steps.slice(0, 3).map((step, index) => (
        <Sequence key={step} from={96 + index * 72} durationInFrames={72}>
          <div
            style={{
              position: 'absolute',
              right: 72,
              bottom: 88 + index * 48,
              color: brand.colors.text,
              fontSize: 18,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgb(10 10 12 / 0.72)',
              border: '1px solid rgb(255 255 255 / 0.12)',
            }}
          >
            {step}
          </div>
        </Sequence>
      ))}

      <BrandWatermark />
    </AbsoluteFill>
  );
};
