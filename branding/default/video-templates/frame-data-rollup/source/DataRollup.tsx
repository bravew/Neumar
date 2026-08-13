import React from 'react';

import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export interface DataRollupItem {
  label: string;
  value: number;
  color?: string;
}

export interface DataRollupProps {
  title?: string;
  subtitle?: string;
  unit?: string;
  items?: DataRollupItem[];
  data?: {
    title?: string;
    subtitle?: string;
    unit?: string;
    items?: DataRollupItem[];
  };
  accent?: string;
  background?: string;
  foreground?: string;
}

const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const DEFAULT_ACCENT = '#F97316';
const DEFAULT_BACKGROUND = '#101114';
const DEFAULT_FOREGROUND = '#F8FAFC';

function formatValue(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function cleanItems(items: DataRollupItem[] | undefined): DataRollupItem[] {
  return (items ?? [])
    .map((item) => ({
      ...item,
      value: Number.isFinite(item.value) ? item.value : 0,
    }))
    .slice(0, 7);
}

export const DataRollup: React.FC<DataRollupProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const items = cleanItems(props.items ?? props.data?.items);
  const title = props.title ?? props.data?.title;
  const subtitle = props.subtitle ?? props.data?.subtitle;
  const unit = props.unit ?? props.data?.unit ?? '';
  const accent = props.accent ?? DEFAULT_ACCENT;
  const background = props.background ?? DEFAULT_BACKGROUND;
  const foreground = props.foreground ?? DEFAULT_FOREGROUND;

  const values = items.map((item) => Math.max(0, item.value));
  const maxValue = Math.max(1, ...values);
  const positives = values.filter((v) => v > 0);
  const minPositive = positives.length > 0 ? Math.min(...positives) : maxValue;
  const useLog = minPositive > 0 && maxValue / minPositive >= 50;
  const heightFraction = (value: number): number => {
    if (value <= 0) return 0;
    if (!useLog) return value / maxValue;
    const logMin = Math.log(minPositive);
    const logMax = Math.log(maxValue);
    const t = (Math.log(value) - logMin) / (logMax - logMin || 1);
    return 0.25 + t * 0.75;
  };

  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 200 },
  });
  const titleY = interpolate(titleProgress, [0, 1], [20, 0]);

  const padX = Math.round(width * 0.08);
  const chartTop = Math.round(height * (title ? 0.3 : 0.18));
  const chartBottom = Math.round(height * 0.82);
  const chartHeight = chartBottom - chartTop;
  const slotW = items.length > 0 ? (width - padX * 2) / items.length : 0;
  const barW = Math.min(slotW * 0.52, Math.round(width * 0.12));

  return (
    <AbsoluteFill
      style={{
        backgroundColor: background,
        fontFamily: SYSTEM_SANS,
      }}
    >
      {title ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(height * 0.1),
            left: padX,
            right: padX,
            color: foreground,
            fontSize: Math.round(height * 0.058),
            fontWeight: 800,
            letterSpacing: 0,
            opacity: titleProgress,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {title}
        </div>
      ) : null}

      {subtitle ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(height * 0.17),
            left: padX,
            right: padX,
            color: foreground,
            fontSize: Math.round(height * 0.026),
            fontWeight: 500,
            letterSpacing: 0,
            opacity: titleProgress * 0.68,
            transform: `translateY(${titleY}px)`,
          }}
        >
          {subtitle}
        </div>
      ) : null}

      {items.map((item, index) => {
        const value = Math.max(0, item.value);
        const delay = index * Math.round(fps * 0.12);
        const grow = spring({
          frame: frame - delay,
          fps,
          config: { damping: 14, mass: 0.7, stiffness: 90 },
        });
        const barHeight = Math.max(
          2,
          heightFraction(value) * chartHeight * grow,
        );
        const rolled = value * grow;
        const cx = padX + slotW * index + slotW / 2;
        const color = item.color ?? accent;

        return (
          <React.Fragment key={`${item.label}-${index}`}>
            <div
              style={{
                position: 'absolute',
                left: cx - slotW / 2,
                width: slotW,
                top: chartBottom - barHeight - Math.round(height * 0.07),
                textAlign: 'center',
                color,
                fontFamily: SYSTEM_MONO,
                fontSize: Math.round(height * 0.04),
                fontWeight: 700,
                opacity: grow,
              }}
            >
              {formatValue(rolled)}
              {unit ? ` ${unit}` : ''}
            </div>
            <div
              style={{
                position: 'absolute',
                left: cx - barW / 2,
                width: barW,
                bottom: height - chartBottom,
                height: barHeight,
                backgroundColor: color,
                borderRadius: `${Math.round(barW * 0.12)}px ${Math.round(
                  barW * 0.12,
                )}px 0 0`,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: cx - slotW / 2,
                width: slotW,
                top: chartBottom + Math.round(height * 0.025),
                textAlign: 'center',
                color: foreground,
                fontSize: Math.round(height * 0.028),
                fontWeight: 500,
                opacity: interpolate(grow, [0, 0.4], [0, 0.85], {
                  extrapolateRight: 'clamp',
                }),
              }}
            >
              {item.label}
            </div>
          </React.Fragment>
        );
      })}

      <div
        style={{
          position: 'absolute',
          left: padX,
          right: padX,
          top: chartBottom,
          height: 2,
          backgroundColor: foreground,
          opacity: 0.18,
        }}
      />
    </AbsoluteFill>
  );
};
