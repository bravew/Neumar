import { Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand } from '../theme';
import { MacOSTitleBar } from './MacOSTitleBar';

interface DeviceFrameProps {
  screenshot: string;
  type?: 'desktop' | 'mobile';
  showShadow?: boolean;
}

export const DeviceFrame: React.FC<DeviceFrameProps> = ({
  screenshot,
  type = 'desktop',
  showShadow = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 30,
  });
  const scale = interpolate(entrance, [0, 1], [0.95, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  const borderRadius = type === 'desktop' ? 12 : 24;
  const padding = type === 'desktop' ? 8 : 16;

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        opacity,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
      }}
    >
      <div
        style={{
          background: '#2a2a2a',
          borderRadius: borderRadius + padding,
          padding,
          boxShadow: showShadow
            ? `0 25px 50px -12px ${brand.colors.shadow}40`
            : 'none',
          width: '100%',
        }}
      >
        {type === 'desktop' && <MacOSTitleBar />}

        <Img
          src={staticFile(`screenshots/${screenshot}`)}
          style={{ borderRadius, width: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
};
