export type SuccessSoundId = 'ding' | 'chime' | 'two-tone-up' | 'pluck';
export type FailureSoundId = 'buzz' | 'two-tone-down' | 'thud';
export type SoundId = SuccessSoundId | FailureSoundId;

export interface SoundOption<TId extends SoundId = SoundId> {
  id: TId;
  labelKey: string;
}

export const DEFAULT_SUCCESS_SOUND_ID: SuccessSoundId = 'ding';
export const DEFAULT_FAILURE_SOUND_ID: FailureSoundId = 'buzz';

export const SUCCESS_SOUNDS: SoundOption<SuccessSoundId>[] = [
  { id: 'ding', labelKey: 'notifySoundDing' },
  { id: 'chime', labelKey: 'notifySoundChime' },
  { id: 'two-tone-up', labelKey: 'notifySoundTwoToneUp' },
  { id: 'pluck', labelKey: 'notifySoundPluck' },
];

export const FAILURE_SOUNDS: SoundOption<FailureSoundId>[] = [
  { id: 'buzz', labelKey: 'notifySoundBuzz' },
  { id: 'two-tone-down', labelKey: 'notifySoundTwoToneDown' },
  { id: 'thud', labelKey: 'notifySoundThud' },
];

type AudioContextConstructor = typeof AudioContext;

interface ToneSpec {
  freq: number;
  type: OscillatorType;
  start: number;
  duration: number;
  gain?: number;
  lowpass?: number;
}

let context: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const Ctor: AudioContextConstructor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext;

  if (!Ctor) return null;

  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }

  if (context.state === 'suspended') {
    void context.resume().catch(() => {
      // Autoplay policy can reject background playback. A later user gesture
      // driven preview retries against the same context.
    });
  }

  return context;
}

function playTones(ctx: AudioContext, tones: ToneSpec[]): void {
  const now = ctx.currentTime;

  for (const tone of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = tone.gain ?? 0.18;
    const startAt = now + tone.start;
    const endAt = startAt + tone.duration;

    oscillator.type = tone.type;
    oscillator.frequency.value = tone.freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(
      peak,
      startAt + Math.min(0.005, tone.duration * 0.2),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    let output: AudioNode = oscillator;
    if (tone.lowpass) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = tone.lowpass;
      oscillator.connect(lowpass);
      output = lowpass;
    }

    output.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
  }
}

const SOUND_PLAYERS: Record<SoundId, (ctx: AudioContext) => void> = {
  ding: (ctx) =>
    playTones(ctx, [
      { freq: 880, type: 'sine', start: 0, duration: 0.25, gain: 0.22 },
    ]),
  chime: (ctx) =>
    playTones(ctx, [
      { freq: 880, type: 'triangle', start: 0, duration: 0.4, gain: 0.18 },
      { freq: 1320, type: 'triangle', start: 0, duration: 0.4, gain: 0.12 },
    ]),
  'two-tone-up': (ctx) =>
    playTones(ctx, [
      { freq: 660, type: 'square', start: 0, duration: 0.08, gain: 0.16 },
      { freq: 990, type: 'square', start: 0.09, duration: 0.08, gain: 0.16 },
    ]),
  pluck: (ctx) =>
    playTones(ctx, [
      {
        freq: 220,
        type: 'sawtooth',
        start: 0,
        duration: 0.15,
        gain: 0.22,
        lowpass: 1200,
      },
    ]),
  buzz: (ctx) =>
    playTones(ctx, [
      { freq: 165, type: 'square', start: 0, duration: 0.06, gain: 0.2 },
      { freq: 165, type: 'square', start: 0.1, duration: 0.06, gain: 0.2 },
      { freq: 165, type: 'square', start: 0.2, duration: 0.06, gain: 0.2 },
    ]),
  'two-tone-down': (ctx) =>
    playTones(ctx, [
      { freq: 880, type: 'sine', start: 0, duration: 0.12, gain: 0.2 },
      { freq: 440, type: 'sine', start: 0.13, duration: 0.12, gain: 0.2 },
    ]),
  thud: (ctx) =>
    playTones(ctx, [
      { freq: 80, type: 'sine', start: 0, duration: 0.12, gain: 0.32 },
    ]),
};

export function isSuccessSoundId(id: string): id is SuccessSoundId {
  return SUCCESS_SOUNDS.some((sound) => sound.id === id);
}

export function isFailureSoundId(id: string): id is FailureSoundId {
  return FAILURE_SOUNDS.some((sound) => sound.id === id);
}

export function playSound(id: SoundId): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    SOUND_PLAYERS[id]?.(ctx);
  } catch {
    // Notification sounds should never throw into app workflows.
  }
}

export function previewSuccess(id: SuccessSoundId): void {
  playSound(id);
}

export function previewFailure(id: FailureSoundId): void {
  playSound(id);
}
