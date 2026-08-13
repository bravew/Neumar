export type NativeCaptureComposition =
  | 'camera'
  | 'screen'
  | 'screen+camera'
  | 'screen+camera+mic';

export interface NativeCaptureDevice {
  id: string;
  label: string;
  kind: 'camera' | 'screen' | 'mic';
}

export interface NativeCaptureDevices {
  cameras: NativeCaptureDevice[];
  screens: NativeCaptureDevice[];
  mics: NativeCaptureDevice[];
  nativeAvailable: boolean;
  unavailableReason?: string;
  supportedCompositions: NativeCaptureComposition[];
}

export interface NativeCaptureStartInput {
  projectId: string;
  workspaceRoot: string;
  cameraDevice?: string;
  screenDevice?: string;
  micDevice?: string;
  fps: number;
  resolution: {
    width: number;
    height: number;
  };
  composition: NativeCaptureComposition;
  teleprompter?: {
    enabled: boolean;
    wpm?: number;
    mirror?: boolean;
  };
}

export interface NativeCaptureStartResult {
  captureId: string;
  sessionId: string;
  outputPath: string;
  composition: NativeCaptureComposition;
}

export interface NativeCaptureStatus {
  captureId: string;
  sessionId: string;
  status: 'running' | 'paused' | 'done' | 'unknown';
  elapsedMs: number;
  peakDb?: number;
  droppedFrames: number;
  outputPath: string;
}

export interface NativeCaptureStopResult {
  captureId: string;
  sessionId: string;
  outputPath: string;
  exitCode?: number;
}

function inTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

async function invokeCapture<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function listNativeCaptureDevices(): Promise<NativeCaptureDevices | null> {
  if (!inTauri()) return null;
  try {
    return await invokeCapture<NativeCaptureDevices>('list_capture_devices');
  } catch {
    return null;
  }
}

export async function startNativeCapture(
  opts: NativeCaptureStartInput,
): Promise<NativeCaptureStartResult> {
  return invokeCapture<NativeCaptureStartResult>('start_capture', { opts });
}

export async function pauseNativeCapture(
  sessionId: string,
): Promise<NativeCaptureStatus> {
  return invokeCapture<NativeCaptureStatus>('pause_capture', { sessionId });
}

export async function resumeNativeCapture(
  sessionId: string,
): Promise<NativeCaptureStatus> {
  return invokeCapture<NativeCaptureStatus>('resume_capture', { sessionId });
}

export async function stopNativeCapture(
  sessionId: string,
): Promise<NativeCaptureStopResult> {
  return invokeCapture<NativeCaptureStopResult>('stop_capture', { sessionId });
}

export async function nativeCaptureStatus(
  sessionId: string,
): Promise<NativeCaptureStatus> {
  return invokeCapture<NativeCaptureStatus>('capture_status', { sessionId });
}

export async function nativeCaptureFileUrl(path: string): Promise<string> {
  if (!inTauri()) return path;
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(path);
}
