import { useEffect, useMemo, useState } from 'react';

import { Languages } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { VideoApiError } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  VIDEO_CAPTION_LANGUAGES,
  type VideoCaptionLanguage,
  type VideoProject,
} from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';

interface TranslateCaptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: VideoProject;
  actions: VideoProjectEditorActions;
}

/** Cue-level translations start hidden until the user selects render visibility. */
export function TranslateCaptionsDialog({
  open,
  onOpenChange,
  project,
  actions,
}: TranslateCaptionsDialogProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript.translate;
  const captionTracks = useMemo(
    () =>
      (project.timeline?.tracks ?? []).filter(
        (track) => track.kind === 'caption',
      ),
    [project.timeline?.tracks],
  );
  const [sourceTrackId, setSourceTrackId] = useState(
    () => captionTracks[0]?.id ?? '',
  );
  const [targetLanguage, setTargetLanguage] =
    useState<VideoCaptionLanguage>('es');
  const [destination, setDestination] = useState('');
  const [configured, setConfigured] = useState(false);
  const [confirmedDestination, setConfirmedDestination] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[] | null>(null);
  const [costPrompt, setCostPrompt] = useState<{
    token: string;
    cents: number;
  } | null>(null);
  const [costConfirmed, setCostConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setDestination('');
    setConfigured(false);
    setConfirmedDestination('');
    void fetch(`${API_BASE_URL}/video/caption-translation/destination`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (
          !response.ok ||
          !data ||
          typeof data !== 'object' ||
          !('destination' in data) ||
          typeof data.destination !== 'string' ||
          !('configured' in data) ||
          typeof data.configured !== 'boolean'
        ) {
          throw new Error(labels.noProvider);
        }
        if (active) {
          setDestination(data.destination);
          setConfigured(data.configured);
        }
      })
      .catch(() => {
        if (active) setFailure(labels.noProvider);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [refresh, labels.noProvider]);

  const sourceTrack = captionTracks.find((track) => track.id === sourceTrackId);
  const charCount = (sourceTrack?.clips ?? []).reduce(
    (total, clip) => total + clip.text.length,
    0,
  );
  const estimatedCents =
    charCount > 0 ? Math.max(1, Math.ceil((charCount / 3_000) * 3)) : 0;
  // A stored consent is valid only for the destination returned by the server now.
  const egressConfirmed =
    Boolean(destination) &&
    (confirmedDestination === destination ||
      project.settings?.captionTranslationEgressConsents?.[destination]
        ?.confirmed === true);
  const resetCost = () => {
    setCostPrompt(null);
    setCostConfirmed(false);
  };

  const translate = async () => {
    setBusy(true);
    setFailure(null);
    setSkipped(null);
    try {
      const result = await actions.translateCaptions({
        targetLanguage,
        sourceTrackId,
        consentDestination: destination,
        egressConfirmed,
        costApproval:
          costPrompt && costConfirmed
            ? {
                token: costPrompt.token,
                approvedCents: costPrompt.cents,
                approvedAt: new Date().toISOString(),
                approvedBy: 'user',
              }
            : undefined,
      });
      actions.onProjectUpdated?.(result.project);
      setSkipped(result.skipped);
      if (result.skipped.length === 0) onOpenChange(false);
    } catch (error) {
      if (
        error instanceof VideoApiError &&
        error.data.code === 'cost-approval-required'
      ) {
        const detail = error.data.detail;
        if (
          detail &&
          typeof detail === 'object' &&
          'approvalToken' in detail &&
          typeof detail.approvalToken === 'string' &&
          'estimatedCents' in detail &&
          typeof detail.estimatedCents === 'number'
        ) {
          setCostPrompt({
            token: detail.approvalToken,
            cents: detail.estimatedCents,
          });
          setCostConfirmed(false);
        }
        setFailure(labels.costApprovalRequired);
      } else {
        setFailure(error instanceof Error ? error.message : labels.failed);
        if (
          error instanceof VideoApiError &&
          error.data.code === 'cloud-egress-consent-required'
        ) {
          resetCost();
          setRefresh((value) => value + 1);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Languages className="size-4" />
            {labels.title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {labels.description}
          </DialogDescription>
        </DialogHeader>
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">
          {labels.sourceLabel}
          <select
            value={sourceTrackId}
            disabled={busy}
            onChange={(event) => {
              setSourceTrackId(event.target.value);
              resetCost();
            }}
            className="border-border bg-background text-foreground rounded border px-2 py-1.5"
          >
            {captionTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.language
                  ? `${track.name} (${track.language})`
                  : track.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">
          {labels.targetLabel}
          <select
            value={targetLanguage}
            disabled={busy}
            onChange={(event) => {
              const language = VIDEO_CAPTION_LANGUAGES.find(
                (code) => code === event.target.value,
              );
              if (language) setTargetLanguage(language);
              resetCost();
            }}
            className="border-border bg-background text-foreground rounded border px-2 py-1.5"
          >
            {VIDEO_CAPTION_LANGUAGES.map((code) => (
              <option
                key={code}
                value={code}
                disabled={code === sourceTrack?.language}
              >
                {labels.languages[code]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground text-xs break-all">
          {labels.providerLabel}: {configured ? destination : labels.noProvider}
        </p>
        <label className="hover:bg-accent flex items-start gap-2 rounded-md p-1.5 text-xs">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={egressConfirmed}
            disabled={
              busy ||
              !configured ||
              project.settings?.captionTranslationEgressConsents?.[destination]
                ?.confirmed === true
            }
            onChange={(event) =>
              setConfirmedDestination(event.target.checked ? destination : '')
            }
          />
          <span className="leading-snug">
            {labels.consent.replace(
              '{provider}',
              destination || labels.providerLabel,
            )}
          </span>
        </label>
        <p className="text-muted-foreground text-xs">
          {labels.estimate
            .replace('{cues}', String(sourceTrack?.clips.length ?? 0))
            .replace(
              '{cost}',
              ((costPrompt?.cents ?? estimatedCents) / 100).toFixed(2),
            )}
        </p>
        {costPrompt ? (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={costConfirmed}
              disabled={busy}
              onChange={(event) => setCostConfirmed(event.target.checked)}
            />
            <span>{labels.costApprovalRequired}</span>
          </label>
        ) : null}
        {skipped ? (
          <p className="text-muted-foreground text-xs">
            {labels.partial.replace('{count}', String(skipped.length))}
          </p>
        ) : null}
        {failure ? (
          <p className="text-destructive text-xs" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {labels.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              busy ||
              !sourceTrackId ||
              !egressConfirmed ||
              !configured ||
              sourceTrack?.language === targetLanguage ||
              Boolean(costPrompt && !costConfirmed)
            }
            onClick={() => void translate()}
          >
            {busy ? labels.translating : labels.action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
