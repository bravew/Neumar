import { frameToMs } from '@neumar/video-ir';

import type { TimelinePlaybackState } from '../../timeline/useTimelineUiStore';

export interface PlaybackClockScheduler {
  cancelFrame(id: number): void;
  requestFrame(callback: (timestampMs: number) => void): number;
}

export interface PlaybackClockOptions {
  durationInFrames: number;
  fps: number;
  maxFrameLeadSeconds?: number;
  playbackRate?: number;
  onFrame: (frame: number) => void;
  onPlayheadMs?: (ms: number) => void;
  onPlaybackStateChange?: (state: TimelinePlaybackState) => void;
  scheduler?: PlaybackClockScheduler;
}

export class PlaybackClock {
  private frame = 0;
  private lastTickMs: number | null = null;
  private lastPresentedFrame = 0;
  private lastRequestedFrame: number | null = null;
  private pendingRenderFrame: number | null = null;
  private playbackRate: number;
  private rafId: number | null = null;
  private running = false;
  private readonly scheduler: PlaybackClockScheduler;

  constructor(private readonly options: PlaybackClockOptions) {
    this.scheduler = options.scheduler ?? browserScheduler;
    this.playbackRate = normalizePlaybackRate(options.playbackRate);
  }

  get currentFrame(): number {
    return Math.round(this.frame);
  }

  get isRunning(): boolean {
    return this.running;
  }

  setPlaybackRate(playbackRate: number): void {
    this.playbackRate = normalizePlaybackRate(playbackRate);
    this.lastTickMs = null;
  }

  seekFrame(frame: number): number {
    this.frame = this.clampFrame(frame);
    this.lastPresentedFrame = this.currentFrame;
    this.lastRequestedFrame = null;
    this.lastTickMs = null;
    this.pendingRenderFrame = null;
    return this.currentFrame;
  }

  play(): void {
    if (this.running) return;
    this.running = true;
    this.lastPresentedFrame = this.currentFrame;
    this.lastRequestedFrame = null;
    this.lastTickMs = null;
    this.pendingRenderFrame = null;
    this.rafId = this.scheduler.requestFrame(this.tick);
    this.options.onPlaybackStateChange?.('playing');
  }

  pause(): void {
    this.cancel();
    this.options.onPlaybackStateChange?.('paused');
  }

  dispose(): void {
    const wasRunning = this.running;
    this.cancel();
    if (wasRunning) {
      this.options.onPlaybackStateChange?.('paused');
    }
  }

  reportRenderStart(frame: number): void {
    this.pendingRenderFrame = this.clampFrame(Math.round(frame));
  }

  reportRenderEnd(frame: number, presented: boolean): void {
    const renderedFrame = this.clampFrame(Math.round(frame));
    if (this.pendingRenderFrame === renderedFrame) {
      this.pendingRenderFrame = null;
    }
    if (presented) {
      this.lastPresentedFrame = Math.max(
        this.lastPresentedFrame,
        renderedFrame,
      );
    } else if (this.lastRequestedFrame === renderedFrame) {
      this.lastRequestedFrame = null;
    }
  }

  private readonly tick = (timestampMs: number): void => {
    if (!this.running) return;
    const elapsedMs =
      this.lastTickMs === null ? 0 : timestampMs - this.lastTickMs;
    this.lastTickMs = timestampMs;
    const frameDelta = Math.max(
      0,
      (elapsedMs / 1000) * this.options.fps * this.playbackRate,
    );
    const nextFrame = this.clampFrame(this.frame + frameDelta);
    this.frame = Math.min(nextFrame, this.presentationLeadLimitFrame());
    const roundedFrame = this.currentFrame;
    if (
      this.pendingRenderFrame === null &&
      roundedFrame !== this.lastRequestedFrame
    ) {
      this.lastRequestedFrame = roundedFrame;
      this.options.onFrame(roundedFrame);
    }
    this.options.onPlayheadMs?.(frameToMs(roundedFrame, this.options.fps));
    if (roundedFrame >= this.maxFrame()) {
      this.running = false;
      this.rafId = null;
      this.options.onPlaybackStateChange?.('stopped');
      return;
    }
    this.rafId = this.scheduler.requestFrame(this.tick);
  };

  private cancel(): void {
    this.running = false;
    if (this.rafId !== null) {
      this.scheduler.cancelFrame(this.rafId);
      this.rafId = null;
    }
  }

  private clampFrame(frame: number): number {
    if (!Number.isFinite(frame)) return 0;
    return Math.min(Math.max(0, frame), this.maxFrame());
  }

  private maxFrame(): number {
    return Math.max(0, this.options.durationInFrames - 1);
  }

  private presentationLeadLimitFrame(): number {
    const leadFrames = Math.max(
      1,
      Math.round(this.options.fps * (this.options.maxFrameLeadSeconds ?? 0.15)),
    );
    return this.clampFrame(this.lastPresentedFrame + leadFrames);
  }
}

const browserScheduler: PlaybackClockScheduler = {
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
};

function normalizePlaybackRate(playbackRate = 1): number {
  return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
}
