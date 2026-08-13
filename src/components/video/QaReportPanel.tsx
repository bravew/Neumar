import { useEffect, useState } from 'react';

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock3,
  Film,
  ImageOff,
  Scissors,
  Volume2,
  VolumeX,
} from 'lucide-react';

import type { TranslationKeys } from '@/config/locale';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoQaReport, VideoRenderOutput } from '@/shared/types/video';

interface QaReportPanelProps {
  output?: VideoRenderOutput;
}

type QaReportSectionKey =
  | 'blackFrames'
  | 'audioClipping'
  | 'silentGaps'
  | 'missingMedia'
  | 'cutBoundaries'
  | 'durationMismatch';

const SECTION_ICONS = {
  blackFrames: Film,
  audioClipping: Volume2,
  silentGaps: VolumeX,
  missingMedia: ImageOff,
  cutBoundaries: Scissors,
  durationMismatch: Clock3,
} as const;

const QA_EXPANDED_STORAGE_KEY = 'neuma.video.qaReport.expanded';

export function QaReportPanel({ output }: QaReportPanelProps) {
  const { t } = useLanguage();
  const report = output?.qaReport;
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(QA_EXPANDED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(QA_EXPANDED_STORAGE_KEY, String(expanded));
    } catch {
      // best-effort only
    }
  }, [expanded]);

  if (!report) return null;

  const sections = qaSections(report, t);
  const issueCount = sections.reduce(
    (total, section) => total + section.count,
    0,
  );
  if (issueCount === 0) return null;

  return (
    <div className="border-border bg-background/95 shrink-0 border-t px-4 py-1.5">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
          )}
          <AlertTriangle className="text-destructive size-4 shrink-0" />
          <span className="text-foreground text-xs font-medium">
            {t.video.editor.qa.title}
          </span>
          <span className="text-destructive text-xs">
            {t.video.editor.qa.issueCount.replace(
              '{count}',
              String(issueCount),
            )}
          </span>
        </div>
        <span className="text-muted-foreground text-xs">
          {output.aspectRatio} · {formatSeconds(output.durationSec)}
        </span>
      </button>
      {expanded ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {sections
            .filter((section) => section.count > 0)
            .map((section) => {
              const Icon = SECTION_ICONS[section.key];
              return (
                <div
                  key={section.key}
                  className="border-border bg-muted/40 rounded-md border px-2 py-1.5"
                >
                  <div className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                    <Icon className="size-3.5 shrink-0" />
                    <span>{section.label}</span>
                    <span className="text-muted-foreground">
                      {section.count}
                    </span>
                  </div>
                  {section.detail ? (
                    <div className="text-muted-foreground mt-1 truncate text-[11px]">
                      {section.detail}
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}

function qaSections(
  report: VideoQaReport,
  t: TranslationKeys,
): Array<{
  key: QaReportSectionKey;
  label: string;
  count: number;
  detail?: string;
}> {
  return [
    {
      key: 'blackFrames',
      label: t.video.editor.qa.blackFrames,
      count: report.blackFrames.length,
      detail: report.blackFrames[0]
        ? formatRange(
            report.blackFrames[0].startMs,
            report.blackFrames[0].endMs,
          )
        : undefined,
    },
    {
      key: 'audioClipping',
      label: t.video.editor.qa.audioClipping,
      count: report.audioClipping.length,
      detail: report.audioClipping[0]
        ? `${formatRange(
            report.audioClipping[0].startMs,
            report.audioClipping[0].endMs,
          )} - ${t.video.editor.qa.peak.replace(
            '{peak}',
            String(report.audioClipping[0].peakDbfs),
          )}`
        : undefined,
    },
    {
      key: 'silentGaps',
      label: t.video.editor.qa.silentGaps,
      count: report.silentGaps.length,
      detail: report.silentGaps[0]
        ? formatRange(report.silentGaps[0].startMs, report.silentGaps[0].endMs)
        : undefined,
    },
    {
      key: 'missingMedia',
      label: t.video.editor.qa.missingMedia,
      count: report.missingMedia.length,
      detail: report.missingMedia[0]?.sceneId ?? report.missingMedia[0]?.clipId,
    },
    {
      key: 'cutBoundaries',
      label: t.video.editor.qa.cutBoundaries,
      count: (report.cutBoundaries ?? []).reduce(
        (total, boundary) => total + boundary.issues.length,
        0,
      ),
      detail: report.cutBoundaries?.[0]
        ? formatRange(
            report.cutBoundaries[0].windowStartMs,
            report.cutBoundaries[0].windowEndMs,
          )
        : undefined,
    },
    {
      key: 'durationMismatch',
      label: t.video.editor.qa.durationMismatch,
      count: report.durationMismatch ? 1 : 0,
      detail: report.durationMismatch
        ? `${report.durationMismatch.deltaMs > 0 ? '+' : ''}${
            report.durationMismatch.deltaMs
          }ms`
        : undefined,
    },
  ];
}

function formatRange(startMs: number, endMs: number): string {
  return `${formatTime(startMs)} - ${formatTime(endMs)}`;
}

function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatSeconds(seconds: number): string {
  return formatTime(seconds * 1000);
}
