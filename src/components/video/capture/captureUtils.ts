import type {
  NativeCaptureComposition,
  NativeCaptureDevices,
} from '@/shared/lib/video-capture';
import type { VideoProject } from '@/shared/types/video';

export interface NativeCaptureSelection {
  composition: NativeCaptureComposition;
  cameraDevice?: string;
  screenDevice?: string;
  micDevice?: string;
}

export interface NativeCapturePreference {
  composition?: NativeCaptureComposition;
  cameraDevice?: string;
  screenDevice?: string;
  micDevice?: string;
}

export function captureScript(project: VideoProject): string {
  return (
    project.script ||
    project.storyboard?.narration?.segments
      .map((segment) => segment.text)
      .join(' ') ||
    project.storyboard?.scenes
      .map((scene) => scene.caption?.text ?? scene.intent)
      .join(' ') ||
    project.prompt
  );
}

export function currentPromptText(
  script: string,
  elapsedMs: number,
  wpm: number,
): string {
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length === 0) return script;
  const currentWord = Math.floor((elapsedMs / 60000) * wpm);
  const start = Math.max(0, currentWord - 8);
  return words.slice(start, start + 26).join(' ');
}

export function bestMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return (
    candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
    ''
  );
}

export function extension(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function selectNativeCapture(
  devices: NativeCaptureDevices | null,
  preference?: NativeCapturePreference,
): NativeCaptureSelection | null {
  if (!devices?.nativeAvailable) return null;
  const cameraDevice = selectDevice(devices.cameras, preference?.cameraDevice);
  const screenDevice = selectDevice(devices.screens, preference?.screenDevice);
  const micDevice = selectDevice(devices.mics, preference?.micDevice);
  const compositions = [
    preference?.composition,
    'screen+camera+mic',
    'screen+camera',
    'camera',
    'screen',
  ].filter(Boolean) as NativeCaptureComposition[];
  const supported = new Set(
    devices.supportedCompositions.length
      ? devices.supportedCompositions
      : ['screen+camera+mic', 'screen+camera', 'camera', 'screen'],
  );
  for (const composition of compositions) {
    if (!supported.has(composition)) continue;
    if (nativeCompositionUsesScreen(composition) && !screenDevice) continue;
    if (nativeCompositionUsesCamera(composition) && !cameraDevice) continue;
    if (composition === 'screen+camera+mic' && !micDevice) continue;
    return {
      composition,
      cameraDevice: nativeCompositionUsesCamera(composition)
        ? cameraDevice
        : undefined,
      screenDevice: nativeCompositionUsesScreen(composition)
        ? screenDevice
        : undefined,
      micDevice,
    };
  }
  return null;
}

export function nativeCompositionUsesCamera(
  composition: NativeCaptureComposition,
): boolean {
  return composition === 'camera' || composition.startsWith('screen+camera');
}

export function nativeCompositionUsesScreen(
  composition: NativeCaptureComposition,
): boolean {
  return composition === 'screen' || composition.startsWith('screen+');
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function selectDevice(
  devices: Array<{ id: string }>,
  preferredId: string | undefined,
): string | undefined {
  if (preferredId && devices.some((device) => device.id === preferredId)) {
    return preferredId;
  }
  return devices[0]?.id;
}
