import { describe, expect, it } from 'vitest';

import { selectNativeCapture } from '@/components/video/capture/captureUtils';
import type { NativeCaptureDevices } from '@/shared/lib/video-capture';

function devices(partial: Partial<NativeCaptureDevices>): NativeCaptureDevices {
  return {
    cameras: [],
    screens: [],
    mics: [],
    nativeAvailable: true,
    supportedCompositions: [],
    ...partial,
  };
}

describe('selectNativeCapture', () => {
  it('prefers screen plus camera plus mic when all devices exist', () => {
    const selection = selectNativeCapture(
      devices({
        cameras: [{ id: 'cam-1', label: 'Camera', kind: 'camera' }],
        screens: [{ id: 'screen-1', label: 'Screen', kind: 'screen' }],
        mics: [{ id: 'mic-1', label: 'Mic', kind: 'mic' }],
      }),
    );

    expect(selection).toEqual({
      composition: 'screen+camera+mic',
      cameraDevice: 'cam-1',
      screenDevice: 'screen-1',
      micDevice: 'mic-1',
    });
  });

  it('falls back to camera capture before screen-only capture', () => {
    expect(
      selectNativeCapture(
        devices({
          cameras: [{ id: 'cam-1', label: 'Camera', kind: 'camera' }],
        }),
      ),
    ).toEqual({
      composition: 'camera',
      cameraDevice: 'cam-1',
      micDevice: undefined,
    });
  });

  it('honors preferred native devices when the composition is supported', () => {
    const selection = selectNativeCapture(
      devices({
        cameras: [
          { id: 'cam-1', label: 'Camera 1', kind: 'camera' },
          { id: 'cam-2', label: 'Camera 2', kind: 'camera' },
        ],
        screens: [
          { id: 'screen-1', label: 'Screen 1', kind: 'screen' },
          { id: 'screen-2', label: 'Screen 2', kind: 'screen' },
        ],
        mics: [
          { id: 'mic-1', label: 'Mic 1', kind: 'mic' },
          { id: 'mic-2', label: 'Mic 2', kind: 'mic' },
        ],
        supportedCompositions: ['screen+camera+mic', 'camera'],
      }),
      {
        composition: 'screen+camera+mic',
        cameraDevice: 'cam-2',
        screenDevice: 'screen-2',
        micDevice: 'mic-2',
      },
    );

    expect(selection).toEqual({
      composition: 'screen+camera+mic',
      cameraDevice: 'cam-2',
      screenDevice: 'screen-2',
      micDevice: 'mic-2',
    });
  });

  it('returns null when native capture is unavailable', () => {
    expect(selectNativeCapture(devices({ nativeAvailable: false }))).toBeNull();
  });
});
