import { useCallback, useEffect, useMemo, useState } from 'react';

import { Send, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import type {
  PublishDestinationInput,
  PublishDestinationOption,
  PublishJobSnapshot,
  PublishMetadataInput,
  PublishSourceArtifact,
} from '@/shared/hooks/usePublishJobs';
import {
  publishDestinationOptionId,
  usePublishJobs,
} from '@/shared/hooks/usePublishJobs';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { DestinationPicker } from './DestinationPicker';

interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: PublishSourceArtifact;
  workspaceId?: string;
  onCreated?: (snapshot: PublishJobSnapshot) => void;
}

export function PublishModal({
  open,
  onOpenChange,
  source,
  workspaceId = 'local',
  onCreated,
}: PublishModalProps) {
  const { t } = useLanguage();
  const p = t.publish as Record<string, string>;
  const { createJob } = usePublishJobs({ workspaceId });
  const [step, setStep] = useState(0);
  const [destinations, setDestinations] = useState<PublishDestinationOption[]>(
    [],
  );
  const [selectedDestinationIds, setSelectedDestinationIds] = useState<
    string[]
  >([]);
  const [metadata, setMetadata] = useState<PublishMetadataInput>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch(`${API_BASE_URL}/publish/destinations`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { items: PublishDestinationOption[] };
      })
      .then((body) => {
        if (!ctrl.signal.aborted) setDestinations(body.items ?? []);
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => ctrl.abort();
  }, [open]);

  const selectedDestinations = useMemo(
    () =>
      destinations.filter((destination) =>
        selectedDestinationIds.includes(
          publishDestinationOptionId(destination),
        ),
      ),
    [destinations, selectedDestinationIds],
  );

  const toggleDestination = useCallback((destinationId: string) => {
    setSelectedDestinationIds((prev) =>
      prev.includes(destinationId)
        ? prev.filter((candidate) => candidate !== destinationId)
        : [...prev, destinationId],
    );
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const snapshot = await createJob({
        workspaceId,
        createdBy: 'human:desktop',
        source,
        metadata,
        destinations: selectedDestinations.map<PublishDestinationInput>(
          (destination) => ({
            kind: destination.kind,
            connectionId: destination.connectionId ?? destination.kind,
            label: destination.label,
            approvalRequired: Boolean(destination.capabilities.approvalDefault),
          }),
        ),
      });
      onCreated?.(snapshot);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [
    createJob,
    metadata,
    onCreated,
    onOpenChange,
    selectedDestinations,
    source,
    workspaceId,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg shadow-xl">
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{p.modalTitle}</h2>
            <p className="text-muted-foreground text-sm">{p.modalSubtitle}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label={p.close}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex gap-2 border-b px-5 py-3">
          {[p.stepDestinations, p.stepMetadata, p.stepReview].map(
            (label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm',
                  step === index
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {label}
              </button>
            ),
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {step === 0 && (
            <DestinationPicker
              destinations={destinations}
              selectedDestinationIds={selectedDestinationIds}
              onToggle={toggleDestination}
            />
          )}
          {step === 1 && (
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-sm font-medium">{p.titleLabel}</span>
                <input
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                  value={metadata.title ?? ''}
                  onChange={(event) =>
                    setMetadata((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm font-medium">{p.captionLabel}</span>
                <textarea
                  className="border-input bg-background min-h-28 w-full rounded-md border px-3 py-2 text-sm"
                  value={metadata.description ?? ''}
                  onChange={(event) =>
                    setMetadata((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3 text-sm">
              <div className="font-medium">{p.reviewTitle}</div>
              <ul className="space-y-2">
                {selectedDestinations.map((destination) => (
                  <li
                    key={publishDestinationOptionId(destination)}
                    className="flex justify-between"
                  >
                    <span>
                      {destination.label ??
                        p[
                          `destination_${destination.kind.replace(/-/g, '_')}`
                        ] ??
                        destination.kind}
                    </span>
                    <span className="text-muted-foreground">
                      {destination.capabilities.approvalDefault
                        ? p.approvalRequired
                        : p.noApprovalRequired}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-destructive mt-4 text-sm">{error}</p>}
        </div>

        <div className="border-border flex items-center justify-between border-t px-5 py-4">
          <Button
            variant="outline"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
          >
            {p.back}
          </Button>
          {step < 2 ? (
            <Button
              onClick={() => setStep((current) => Math.min(2, current + 1))}
              disabled={step === 0 && selectedDestinationIds.length === 0}
            >
              {p.next}
            </Button>
          ) : (
            <Button
              onClick={() => void submit()}
              disabled={submitting || selectedDestinationIds.length === 0}
            >
              <Send className="size-4" />
              {submitting ? p.submitting : p.publish}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
