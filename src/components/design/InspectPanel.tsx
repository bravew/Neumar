import {
  type InspectStylePatch,
  INSPECT_STYLE_PROPS,
  type InspectStyleProp,
  type NeumaTargetPayload,
} from '@/components/artifacts/live/iframe-sandbox';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';

const NUMERIC_PROPS = new Set<InspectStyleProp>([
  'fontSize',
  'borderRadius',
  'width',
  'minHeight',
]);

export function InspectPanel({
  target,
  onPatch,
}: {
  target: NeumaTargetPayload | null;
  onPatch: (patch: InspectStylePatch) => void;
}) {
  const { t } = useLanguage();

  if (!target) {
    return (
      <aside className="bg-background w-72 shrink-0 border-l p-3 text-sm">
        <h2 className="font-semibold">{t.design.inspectPanel}</h2>
        <p className="text-muted-foreground mt-2 text-xs">
          {t.design.inspectNoSelection}
        </p>
      </aside>
    );
  }

  const styles = target.styles ?? {};
  return (
    <aside className="bg-background w-72 shrink-0 overflow-auto border-l p-3 text-sm">
      <div className="min-w-0">
        <h2 className="font-semibold">{t.design.inspectPanel}</h2>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          {target.label || target.id}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {(target.role || target.tagName).toLowerCase()}
        </p>
      </div>

      {target.text && (
        <blockquote className="bg-muted/50 mt-3 line-clamp-3 rounded-md p-2 text-xs">
          {target.text}
        </blockquote>
      )}

      <div className="mt-4 space-y-3">
        {INSPECT_STYLE_PROPS.map((prop) => (
          <StyleControl
            key={prop}
            id={target.id}
            prop={prop}
            value={styles[prop] ?? ''}
            onPatch={onPatch}
          />
        ))}
      </div>
    </aside>
  );
}

function StyleControl({
  id,
  prop,
  value,
  onPatch,
}: {
  id: string;
  prop: InspectStyleProp;
  value: string;
  onPatch: (patch: InspectStylePatch) => void;
}) {
  const numeric = NUMERIC_PROPS.has(prop);
  const numericValue = Number.parseFloat(value);
  const { t } = useLanguage();

  const patch = (next: string) => onPatch({ id, prop, value: next });

  return (
    <label className="block text-xs">
      <span className="text-muted-foreground flex items-center justify-between gap-2">
        <span className="truncate">{prop}</span>
        <code className="bg-muted max-w-32 truncate rounded px-1 py-0.5">
          {value || '-'}
        </code>
      </span>
      {numeric && Number.isFinite(numericValue) ? (
        <input
          className="mt-2 w-full"
          type="range"
          min={0}
          max={prop === 'width' ? 1600 : 160}
          value={numericValue}
          onChange={(event) => patch(`${event.target.value}px`)}
        />
      ) : (
        <div className="mt-2 flex gap-2">
          <input
            className="border-input min-w-0 flex-1 rounded-md border px-2 py-1"
            value={value}
            onChange={(event) => patch(event.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => patch('')}
          >
            {t.common.reset}
          </Button>
        </div>
      )}
    </label>
  );
}
