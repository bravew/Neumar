import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useVideoConfig,
} from 'remotion';

import { Annotation } from '../components/Annotation';
import { MacOSTitleBar } from '../components/MacOSTitleBar';
import { ZoomEffect } from '../components/ZoomEffect';

interface AnnotationSpec {
  text: string;
  x: number;
  y: number;
  direction?: 'top' | 'bottom' | 'left' | 'right';
  fromFrame: number;
}

interface ZoomSpec {
  targetX: number;
  targetY: number;
  zoomLevel: number;
  fromFrame: number;
  durationInFrames: number;
  holdFrames?: number;
}

interface ScreenRecordingSceneProps {
  /** Path to recording in public/recordings/ */
  recording: string;
  /** Annotations overlaid on the recording */
  annotations?: AnnotationSpec[];
  /** Zoom effects applied at specific frames */
  zooms?: ZoomSpec[];
  /** Start time offset in the source recording (frames) */
  startFrom?: number;
}

/**
 * Reusable scene that embeds a Playwright WebM recording
 * with programmatic overlays (annotations, zoom effects).
 *
 * This is the core pattern of the recording-first pipeline.
 */
export const ScreenRecordingScene: React.FC<ScreenRecordingSceneProps> = ({
  recording,
  annotations = [],
  zooms = [],
  startFrom = 0,
}) => {
  const { fps: _fps } = useVideoConfig();
  const recordingPath = recording.includes('/')
    ? recording
    : `recordings/${recording}`;

  return (
    <AbsoluteFill>
      {/* Layer 1: Recording in device frame */}
      <div
        style={{
          padding: '3% 8%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            background: '#2a2a2a',
            borderRadius: 16,
            padding: 8,
            width: '100%',
          }}
        >
          <MacOSTitleBar />
          <OffthreadVideo
            src={staticFile(recordingPath)}
            startFrom={startFrom}
            style={{ width: '100%', borderRadius: 8, display: 'block' }}
          />
        </div>
      </div>

      {/* Layer 2: Zoom effects */}
      {zooms.map((zoom, i) => (
        <Sequence
          key={i}
          from={zoom.fromFrame}
          durationInFrames={
            zoom.durationInFrames +
            (zoom.holdFrames ?? 60) +
            zoom.durationInFrames
          }
        >
          <ZoomEffect
            targetX={zoom.targetX}
            targetY={zoom.targetY}
            zoomLevel={zoom.zoomLevel}
            startFrame={0}
            durationInFrames={zoom.durationInFrames}
            holdFrames={zoom.holdFrames}
          >
            <OffthreadVideo
              src={staticFile(recordingPath)}
              startFrom={startFrom + zoom.fromFrame}
              style={{ width: '100%', borderRadius: 8, display: 'block' }}
            />
          </ZoomEffect>
        </Sequence>
      ))}

      {/* Layer 3: Annotations */}
      {annotations.map((ann, i) => (
        <Sequence key={i} from={ann.fromFrame}>
          <Annotation
            text={ann.text}
            x={ann.x}
            y={ann.y}
            direction={ann.direction}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
