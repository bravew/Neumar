import { Copy, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignAssetProvenance } from '@/shared/types/design-mode';

export function AssetProvenanceDialog({
  open,
  onOpenChange,
  provenance,
  onOpenPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provenance: DesignAssetProvenance | null;
  onOpenPrompt?: (path: string) => void;
}) {
  const { t } = useLanguage();
  const promptPath = promptSnapshotPath(provenance?.promptSnapshot);
  const copy = () =>
    navigator.clipboard
      ?.writeText(JSON.stringify(provenance ?? {}, null, 2))
      .catch(() => {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.design.assetProvenance}</DialogTitle>
          <DialogDescription>
            {t.design.assetProvenanceDescription}
          </DialogDescription>
        </DialogHeader>
        {!provenance ? (
          <p className="text-muted-foreground text-sm">
            {t.design.noProvenance}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Meta
                label={t.design.assetProvider}
                value={provenance.provider}
              />
              <Meta label={t.design.assetModel} value={provenance.model} />
              <Meta label={t.design.assetPath} value={provenance.path} />
              <Meta label={t.design.assetTaskId} value={provenance.taskId} />
              <Meta
                label={t.design.assetPromptHash}
                value={provenance.promptHash}
              />
              <Meta label={t.design.createdAt} value={provenance.createdAt} />
            </div>
            {provenance.disclosureText && (
              <section className="rounded-md border p-3">
                <h3 className="text-sm font-medium">
                  {t.design.assetDisclosure}
                </h3>
                <DisclosureText text={provenance.disclosureText} />
              </section>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={copy}>
                <Copy className="size-4" />
                {t.design.copyProvenance}
              </Button>
              {promptPath && onOpenPrompt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenPrompt(promptPath)}
                >
                  <FileText className="size-4" />
                  {t.design.openPromptSnapshot}
                </Button>
              )}
            </div>
            <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {JSON.stringify(provenance, null, 2)}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisclosureText({ text }: { text: string }) {
  const entries = parseProvenanceDisclosure(text);
  if (entries.length === 0) {
    return <p className="text-muted-foreground mt-1 text-sm">{text}</p>;
  }
  return (
    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
      {entries.map((entry) => (
        <div key={`${entry.label}:${entry.value}`} className="min-w-0">
          <dt className="text-muted-foreground text-xs">{entry.label}</dt>
          <dd className="text-foreground break-words">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function parseProvenanceDisclosure(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => parseProvenanceDisclosureLine(line))
    .filter((entry): entry is { label: string; value: string } =>
      Boolean(entry),
    );
}

function parseProvenanceDisclosureLine(line: string) {
  const normalized = line
    .trim()
    .replace(/^\*\*([^*]+?):\*\*\s*/, '$1: ')
    .replace(/^\*\*([^*]+?)\*\*:\s*/, '$1: ');
  const match = /^([^:]{1,80}):\s*(.+)$/.exec(normalized);
  if (!match) return null;
  return { label: match[1]!.trim(), value: match[2]!.trim() };
}

function Meta({ label, value }: { label: string; value?: string }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-sm font-medium break-all">
        {value || t.design.notAvailable}
      </p>
    </div>
  );
}

function promptSnapshotPath(value?: string) {
  if (!value) return null;
  return value.split('@')[0] || null;
}
