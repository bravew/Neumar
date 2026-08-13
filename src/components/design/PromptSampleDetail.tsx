import { Button } from '@/components/ui/button';
import type { PromptLibrarySample } from '@/shared/design/prompt-library-types';

export function PromptSampleDetail({
  labels,
  sample,
  onUse,
}: {
  labels: {
    category: string;
    parameters: string;
    source: string;
    useThis: string;
  };
  sample: PromptLibrarySample | null;
  onUse: (sample: PromptLibrarySample) => void;
}) {
  if (!sample) {
    return null;
  }

  const parameters = promptParameters(sample);

  return (
    <aside className="border-border bg-muted/20 flex min-h-0 flex-col rounded-md border">
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <div>
          <h3 className="text-base font-semibold">{sample.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1 text-xs">
            {sample.category && (
              <Chip label={`${labels.category}: ${sample.category}`} />
            )}
            {sample.model && <Chip label={sample.model} />}
            {sample.aspect && <Chip label={sample.aspect} />}
          </div>
        </div>
        <pre className="border-border bg-background rounded-md border p-3 text-sm leading-6 whitespace-pre-wrap">
          {sample.prompt}
        </pre>
        {parameters.length > 0 && (
          <section>
            <h4 className="text-sm font-medium">{labels.parameters}</h4>
            <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              {parameters.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 truncate">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {sample.source && (
          <section>
            <h4 className="text-sm font-medium">{labels.source}</h4>
            <p className="text-muted-foreground mt-1 text-sm">
              {[sample.source.repo, sample.source.author, sample.source.license]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </section>
        )}
      </div>
      <div className="border-border border-t p-3">
        <Button
          type="button"
          className="w-full"
          data-testid="prompt-library-use-sample"
          onClick={() => onUse(sample)}
        >
          {labels.useThis}
        </Button>
      </div>
    </aside>
  );
}

function promptParameters(sample: PromptLibrarySample) {
  return [
    ['seed', sample.seed],
    ['steps', sample.steps],
    ['cfg', sample.cfgScale],
    ['sampler', sample.sampler],
    ['duration', sample.durationSec],
    ['fps', sample.fps],
    ...Object.entries(sample.parameters ?? {}),
  ]
    .filter((entry): entry is [string, string | number | boolean] =>
      ['string', 'number', 'boolean'].includes(typeof entry[1]),
    )
    .map(([key, value]) => [key, String(value)] as const);
}

function Chip({ label }: { label: string }) {
  return <span className="bg-background rounded px-1.5 py-0.5">{label}</span>;
}
