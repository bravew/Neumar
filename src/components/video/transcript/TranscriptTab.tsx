import { useMemo, useState, type ComponentProps } from 'react';

import { FileText } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { TranscriptView } from '../TranscriptView';
import { SourceTranscriptPanel } from './SourceTranscriptPanel';
import { buildSourceTranscriptViews } from './sourceTranscriptView';

type TranscriptViewProps = ComponentProps<typeof TranscriptView>;
type Pane = 'speech' | 'scenes';

/**
 * Transcript tab with the source-speech panel (word-level, cut-aware) beside
 * the existing scene/caption text editor. Falls back to the scene editor alone
 * when no analyzed source has a word-timed transcript.
 */
export function TranscriptTab(props: TranscriptViewProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;
  const [pane, setPane] = useState<Pane>('speech');
  const hasSpeech = useMemo(
    () => buildSourceTranscriptViews(props.project).length > 0,
    [props.project],
  );
  if (!hasSpeech) return <TranscriptView {...props} />;

  const panes: Array<{ id: Pane; label: string }> = [
    { id: 'speech', label: labels.sourceTitle },
    { id: 'scenes', label: labels.scenesTab },
  ];
  return (
    <section
      className={cn(
        'border-border bg-background flex min-h-0 flex-col rounded-md border',
        props.className,
      )}
      aria-label={labels.title}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <FileText className="text-muted-foreground size-4 shrink-0" />
        <h3 className="text-foreground text-sm font-semibold">
          {labels.title}
        </h3>
        <div role="tablist" className="ml-auto flex gap-1">
          {panes.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pane === id}
              onClick={() => setPane(id)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px]',
                pane === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {pane === 'speech' ? (
        <SourceTranscriptPanel
          project={props.project}
          onCorrectWord={props.actions.patchSourceTranscript}
        />
      ) : (
        <TranscriptView {...props} className="min-h-0 flex-1 border-0" />
      )}
    </section>
  );
}
