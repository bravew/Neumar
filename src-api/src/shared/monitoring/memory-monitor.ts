/**
 * Memory Monitor
 *
 * Periodically samples process memory usage, detects anomalous growth,
 * and triggers alerts when thresholds are breached.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MemoryMonitor');

interface MemorySnapshot {
  timestamp: number;
  rss: number; // MB
  heapTotal: number; // MB
  heapUsed: number; // MB
  external: number; // MB
  arrayBuffers: number; // MB
}

interface MemoryAlert {
  type: 'growth' | 'threshold' | 'leak_detected';
  timestamp: number;
  message: string;
  snapshot: MemorySnapshot;
}

export class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private alerts: MemoryAlert[] = [];
  private monitorInterval: ReturnType<typeof setInterval> | null = null;

  private readonly SAMPLE_INTERVAL = 10_000; // 10 seconds
  private readonly GROWTH_THRESHOLD = 0.5; // 50% growth in 5 minutes
  private readonly RSS_THRESHOLD = 2048; // 2GB in MB
  private readonly MAX_SNAPSHOTS = 1000;
  private readonly MAX_ALERTS = 100;
  private readonly ALERT_COOLDOWN = 60_000; // 1 minute between alerts

  private lastAlertTime = 0;

  start(): void {
    if (this.monitorInterval) return;

    logger.info('Starting memory monitoring');
    this.monitorInterval = setInterval(() => {
      this.takeSnapshot();
      this.analyzeMemoryTrends();
    }, this.SAMPLE_INTERVAL);
  }

  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      logger.info('Stopped memory monitoring');
    }
  }

  private takeSnapshot(): void {
    const usage = process.memoryUsage();

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      rss: Math.round(usage.rss / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
      arrayBuffers: Math.round(usage.arrayBuffers / 1024 / 1024),
    };

    this.snapshots.push(snapshot);

    // Trim in place to avoid creating a new array
    if (this.snapshots.length > this.MAX_SNAPSHOTS) {
      const excess = this.snapshots.length - this.MAX_SNAPSHOTS;
      this.snapshots.splice(0, excess);
    }
  }

  private analyzeMemoryTrends(): void {
    if (this.snapshots.length < 2) return;

    const current = this.snapshots[this.snapshots.length - 1]!;

    // Check absolute threshold
    if (current.rss > this.RSS_THRESHOLD) {
      this.createAlert(
        'threshold',
        `RSS memory exceeded ${this.RSS_THRESHOLD}MB: ${current.rss}MB`,
        current,
      );
    }

    // Check growth rate over 5 minutes
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const oldSnapshot = this.snapshots.find((s) => s.timestamp >= fiveMinAgo);

    if (oldSnapshot && oldSnapshot.rss > 0) {
      const growth = (current.rss - oldSnapshot.rss) / oldSnapshot.rss;
      if (growth > this.GROWTH_THRESHOLD) {
        this.createAlert(
          'growth',
          `Memory grew ${(growth * 100).toFixed(1)}% in 5 minutes (${oldSnapshot.rss}MB -> ${current.rss}MB)`,
          current,
        );
      }
    }

    // Detect potential leak (consistent growth over 30 samples)
    if (this.snapshots.length >= 30) {
      const recent = this.snapshots.slice(-30);
      const slope = this.calculateSlope(recent.map((s) => s.heapUsed));
      if (slope > 0.5) {
        this.createAlert(
          'leak_detected',
          `Potential memory leak: consistent heap growth (slope: ${slope.toFixed(2)} MB/sample) over ${recent.length} samples`,
          current,
        );
      }
    }
  }

  private calculateSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i]!;
      sumXY += i * values[i]!;
      sumXX += i * i;
    }

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return 0;

    return (n * sumXY - sumX * sumY) / denominator;
  }

  private createAlert(
    type: MemoryAlert['type'],
    message: string,
    snapshot: MemorySnapshot,
  ): void {
    const now = Date.now();
    if (now - this.lastAlertTime < this.ALERT_COOLDOWN) return;

    const alert: MemoryAlert = { type, timestamp: now, message, snapshot };
    this.alerts.push(alert);
    this.lastAlertTime = now;

    // Trim alerts in place
    if (this.alerts.length > this.MAX_ALERTS) {
      const excess = this.alerts.length - this.MAX_ALERTS;
      this.alerts.splice(0, excess);
    }

    logger.error(`ALERT: ${message}`);
  }

  getMetrics() {
    const current =
      this.snapshots.length > 0
        ? this.snapshots[this.snapshots.length - 1]
        : null;

    return {
      current,
      alertCount: this.alerts.length,
      snapshotCount: this.snapshots.length,
      isMonitoring: this.monitorInterval !== null,
    };
  }

  getAlerts(): MemoryAlert[] {
    return [...this.alerts];
  }
}

// Singleton instance
let memoryMonitor: MemoryMonitor | null = null;

export function getMemoryMonitor(): MemoryMonitor {
  if (!memoryMonitor) {
    memoryMonitor = new MemoryMonitor();
  }
  return memoryMonitor;
}
