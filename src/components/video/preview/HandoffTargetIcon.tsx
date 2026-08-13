import type { ReactNode } from 'react';

import { SiDavinciresolve } from 'react-icons/si';

import { cn } from '@/shared/lib/utils';
import type { VideoEditorHandoffTarget } from '@/shared/types/video';

export type DisplayHandoffTarget = Exclude<
  VideoEditorHandoffTarget,
  'neuma-package'
>;

interface TargetIconProps {
  className?: string;
}

type TargetIconComponent = (props: TargetIconProps) => ReactNode;

function FinalCutProMark({ className }: TargetIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 32 32"
    >
      <rect width="32" height="32" rx="7" fill="#15191f" />
      <path d="M5 9h22v7H5z" fill="#f8fafc" opacity="0.92" />
      <path d="M5 9h5l-2.5 7H5z" fill="#f43f5e" />
      <path d="M10 9h5l-2.5 7h-5z" fill="#fb923c" />
      <path d="M15 9h5l-2.5 7h-5z" fill="#facc15" />
      <path d="M20 9h5l-2.5 7h-5z" fill="#22c55e" />
      <path d="M25 9h2v7h-4.5z" fill="#38bdf8" />
      <rect x="5" y="16" width="22" height="11" rx="2.5" fill="#202631" />
      <path d="M7 18h18v2H7z" fill="#f8fafc" opacity="0.18" />
      <path d="M7 22h14v2H7z" fill="#f8fafc" opacity="0.14" />
    </svg>
  );
}

function PremiereProMark({ className }: TargetIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 32 32"
    >
      <rect width="32" height="32" rx="7" fill="#00005b" />
      <rect
        x="4.5"
        y="4.5"
        width="23"
        height="23"
        rx="4"
        fill="none"
        stroke="#9999ff"
      />
      <text
        fill="#9999ff"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="13"
        fontWeight="700"
        letterSpacing="0"
        x="8"
        y="20.5"
      >
        Pr
      </text>
    </svg>
  );
}

function ResolveMark({ className }: TargetIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center rounded-[7px] bg-[#111827] text-[#f8fafc]',
        className,
      )}
    >
      <SiDavinciresolve className="size-[72%]" />
    </span>
  );
}

function OtioMark({ className }: TargetIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 32 32"
    >
      <rect width="32" height="32" rx="7" fill="#102a43" />
      <path d="M8 9h16v3H8z" fill="#7dd3fc" />
      <path d="M8 15h10v3H8z" fill="#fbbf24" />
      <path d="M8 21h13v3H8z" fill="#34d399" />
      <path
        d="M23 9v15"
        stroke="#f8fafc"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function EdlMark({ className }: TargetIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 32 32"
    >
      <rect width="32" height="32" rx="7" fill="#334155" />
      <path d="M9 7h10l4 4v14H9z" fill="#f8fafc" />
      <path d="M19 7v5h5" fill="#cbd5e1" />
      <text
        fill="#334155"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8"
        fontWeight="700"
        letterSpacing="0"
        x="10.5"
        y="21"
      >
        EDL
      </text>
    </svg>
  );
}

function CapCutMark({ className }: TargetIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 32 32"
    >
      <rect width="32" height="32" rx="7" fill="#f8fafc" />
      <path
        d="M8 9h16l-16 14h16M8 23 24 9"
        fill="none"
        stroke="#0f172a"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

const TARGET_ICONS: Record<DisplayHandoffTarget, TargetIconComponent> = {
  'final-cut-pro': FinalCutProMark,
  'premiere-pro': PremiereProMark,
  resolve: ResolveMark,
  otio: OtioMark,
  edl: EdlMark,
  'capcut-fallback': CapCutMark,
};

export function HandoffTargetIcon({
  className,
  target,
}: {
  className?: string;
  target: DisplayHandoffTarget;
}) {
  const Icon = TARGET_ICONS[target];

  return (
    <span
      className={cn(
        'inline-flex size-6 shrink-0 rounded-[7px] shadow-sm ring-1 ring-black/10',
        className,
      )}
      data-testid={`handoff-target-icon-${target}`}
    >
      <Icon className="size-full" />
    </span>
  );
}
