import { describe, expect, it } from 'vitest';

import {
  PlaybackClock,
  type PlaybackClockScheduler,
} from '@/components/video/preview/webcodecs/PlaybackClock';

describe('PlaybackClock', () => {
  it('advances frames from requestAnimationFrame timestamps', () => {
    const scheduler = new ManualFrameScheduler();
    const frames: number[] = [];
    const playheads: number[] = [];
    const states: string[] = [];
    const clock = new PlaybackClock({
      durationInFrames: 10,
      fps: 30,
      onFrame: (frame) => frames.push(frame),
      onPlaybackStateChange: (state) => states.push(state),
      onPlayheadMs: (ms) => playheads.push(ms),
      scheduler,
    });

    clock.play();
    scheduler.flush(0);
    scheduler.flush(1000 / 30);
    scheduler.flush(2000 / 30);

    expect(frames).toEqual([0, 1, 2]);
    expect(playheads).toEqual([0, 1000 / 30, 2000 / 30]);
    expect(states).toEqual(['playing']);
  });

  it('stops at the final frame', () => {
    const scheduler = new ManualFrameScheduler();
    const frames: number[] = [];
    const states: string[] = [];
    const clock = new PlaybackClock({
      durationInFrames: 3,
      fps: 1,
      onFrame: (frame) => frames.push(frame),
      onPlaybackStateChange: (state) => states.push(state),
      scheduler,
    });

    clock.seekFrame(1);
    clock.play();
    scheduler.flush(0);
    scheduler.flush(1000);

    expect(frames).toEqual([1, 2]);
    expect(clock.isRunning).toBe(false);
    expect(states).toEqual(['playing', 'stopped']);
  });

  it('applies playback rate to frame advancement', () => {
    const scheduler = new ManualFrameScheduler();
    const frames: number[] = [];
    const clock = new PlaybackClock({
      durationInFrames: 10,
      fps: 30,
      onFrame: (frame) => frames.push(frame),
      playbackRate: 2,
      scheduler,
    });

    clock.play();
    scheduler.flush(0);
    scheduler.flush(1000 / 30);

    expect(frames).toEqual([0, 2]);
  });

  it('stalls advancement while a requested frame is still rendering', () => {
    const scheduler = new ManualFrameScheduler();
    const frames: number[] = [];
    let clock: PlaybackClock;
    clock = new PlaybackClock({
      durationInFrames: 120,
      fps: 30,
      onFrame: (frame) => {
        frames.push(frame);
        clock.reportRenderStart(frame);
      },
      scheduler,
    });

    clock.play();
    scheduler.flush(0);
    scheduler.flush(1000);

    expect(frames).toEqual([0]);
    expect(clock.currentFrame).toBe(5);

    clock.reportRenderEnd(0, true);
    scheduler.flush(1000 + 1000 / 30);

    expect(frames).toEqual([0, 5]);
  });

  it('retries a lead-limited frame when the prior render was not presented', () => {
    const scheduler = new ManualFrameScheduler();
    const frames: number[] = [];
    let clock: PlaybackClock;
    clock = new PlaybackClock({
      durationInFrames: 120,
      fps: 30,
      onFrame: (frame) => {
        frames.push(frame);
        clock.reportRenderStart(frame);
      },
      scheduler,
    });

    clock.play();
    scheduler.flush(0);
    clock.reportRenderEnd(0, true);
    scheduler.flush(1000);
    clock.reportRenderEnd(5, false);
    scheduler.flush(1000 + 1000 / 30);

    expect(frames).toEqual([0, 5, 5]);
  });

  it('clamps seeks and cancels a pending frame on pause', () => {
    const scheduler = new ManualFrameScheduler();
    const states: string[] = [];
    const clock = new PlaybackClock({
      durationInFrames: 5,
      fps: 30,
      onFrame: () => undefined,
      onPlaybackStateChange: (state) => states.push(state),
      scheduler,
    });

    expect(clock.seekFrame(99)).toBe(4);
    clock.play();
    expect(scheduler.pendingCount()).toBe(1);
    clock.pause();

    expect(clock.isRunning).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
    expect(states).toEqual(['playing', 'paused']);
  });

  it('notifies paused when disposed while running', () => {
    const scheduler = new ManualFrameScheduler();
    const states: string[] = [];
    const clock = new PlaybackClock({
      durationInFrames: 5,
      fps: 30,
      onFrame: () => undefined,
      onPlaybackStateChange: (state) => states.push(state),
      scheduler,
    });

    clock.play();
    clock.dispose();

    expect(clock.isRunning).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
    expect(states).toEqual(['playing', 'paused']);
  });
});

class ManualFrameScheduler implements PlaybackClockScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, (timestampMs: number) => void>();

  cancelFrame(id: number): void {
    this.callbacks.delete(id);
  }

  requestFrame(callback: (timestampMs: number) => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  }

  flush(timestampMs: number): void {
    const [id, callback] = this.callbacks.entries().next().value ?? [];
    if (id === undefined || !callback) return;
    this.callbacks.delete(id);
    callback(timestampMs);
  }

  pendingCount(): number {
    return this.callbacks.size;
  }
}
