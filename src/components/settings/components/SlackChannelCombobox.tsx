import { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronDown, Hash, Lock } from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface SlackChannel {
  id: string;
  name: string;
  isChannel: boolean;
  isPrivate?: boolean;
}

interface ChannelsResponse {
  success: boolean;
  data?: SlackChannel[];
  nextCursor?: string | null;
  error?: string;
}

type LoadStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error_auth'
  | 'error_scope'
  | 'error_rate'
  | 'error_other';

interface Props {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** When true, render the combobox; otherwise render a manual text input. */
  connected: boolean;
  inputClassName?: string;
  inputId?: string;
}

export function SlackChannelCombobox({
  value,
  onChange,
  disabled,
  connected,
  inputClassName,
  inputId,
}: Props) {
  const { t } = useLanguage();
  const s = (t.settings ?? {}) as Record<string, string>;

  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const loadMoreCtrl = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      loadMoreCtrl.current?.abort();
    };
  }, []);

  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      setStatus((prev) => (prev === 'ready' ? prev : 'loading'));
      const params = new URLSearchParams({ limit: '200' });
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(
        `${API_BASE_URL}/slack/channels?${params.toString()}`,
        { signal },
      );
      if (signal.aborted) return;

      if (res.status === 401) {
        setStatus('error_auth');
        return;
      }
      if (res.status === 403) {
        setStatus('error_scope');
        return;
      }
      if (res.status === 429) {
        setStatus('error_rate');
        return;
      }

      const data = (await res.json()) as ChannelsResponse;
      if (!data.success || !data.data) {
        setStatus('error_other');
        return;
      }

      setChannels((prev) => {
        const merged = [...prev];
        for (const ch of data.data!) {
          if (!seenIds.current.has(ch.id)) {
            seenIds.current.add(ch.id);
            merged.push(ch);
          }
        }
        return merged;
      });
      setNextCursor(data.nextCursor ?? null);
      setStatus('ready');
    },
    [],
  );

  useEffect(() => {
    if (!connected || !open) return;
    if (channels.length > 0) return;
    const controller = new AbortController();
    fetchPage(null, controller.signal).catch(() => {
      if (!controller.signal.aborted) setStatus('error_other');
    });
    return () => controller.abort();
  }, [connected, open, channels.length, fetchPage]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const loadMore = useCallback(() => {
    if (!nextCursor) return;
    loadMoreCtrl.current?.abort();
    const controller = new AbortController();
    loadMoreCtrl.current = controller;
    fetchPage(nextCursor, controller.signal).catch(() => {
      if (!controller.signal.aborted) setStatus('error_other');
    });
  }, [nextCursor, fetchPage]);

  const baseInputClass =
    inputClassName ??
    'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';

  if (!connected) {
    return (
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={baseInputClass}
        placeholder="#engineering"
      />
    );
  }

  const labelForStatus = (() => {
    switch (status) {
      case 'loading':
        return s.slackPickerLoading ?? 'Loading channels…';
      case 'error_auth':
        return s.slackPickerErrorAuth ?? 'Slack auth failed — reconnect.';
      case 'error_scope':
        return (
          s.slackPickerErrorScope ??
          'Missing channels:read scope — re-authorize.'
        );
      case 'error_rate':
        return s.slackPickerErrorRate ?? 'Slack rate limit — try again soon.';
      case 'error_other':
        return s.slackPickerErrorOther ?? 'Could not load channels.';
      default:
        return null;
    }
  })();

  const selectedDisplay =
    value &&
    (channels.find((c) => c.id === value || `#${c.name}` === value)?.name ??
      value);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        id={inputId}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          baseInputClass,
          'flex items-center justify-between text-left',
        )}
      >
        <span className={value ? '' : 'text-muted-foreground'}>
          {selectedDisplay ||
            (s.slackPickerSelectChannel ?? 'Select a channel')}
        </span>
        <ChevronDown className="text-muted-foreground h-4 w-4" />
      </button>

      {open && (
        <div className="bg-popover absolute z-50 mt-1 w-full rounded-md border shadow-lg">
          <Command shouldFilter>
            <CommandInput
              placeholder={s.slackPickerSearch ?? 'Search channels…'}
            />
            <CommandList className="max-h-64 overflow-y-auto">
              {labelForStatus && (
                <div className="text-muted-foreground px-3 py-2 text-xs">
                  {labelForStatus}
                </div>
              )}
              <CommandEmpty>
                {s.slackPickerEmpty ?? 'No channels found.'}
              </CommandEmpty>
              <CommandGroup>
                {channels.map((ch) => (
                  <CommandItem
                    key={ch.id}
                    value={`${ch.name} ${ch.id}`}
                    onSelect={() => {
                      onChange(`#${ch.name}`);
                      setOpen(false);
                    }}
                  >
                    {ch.isPrivate ? (
                      <Lock className="mr-2 h-4 w-4" />
                    ) : (
                      <Hash className="mr-2 h-4 w-4" />
                    )}
                    <span>{ch.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {nextCursor && (
                <button
                  type="button"
                  onClick={loadMore}
                  className="text-muted-foreground hover:bg-accent w-full px-3 py-2 text-left text-xs"
                >
                  {s.slackPickerLoadMore ?? 'Load more channels'}
                </button>
              )}
            </CommandList>
          </Command>
          <div className="text-muted-foreground border-t px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="hover:underline"
            >
              {s.slackPickerManualEntry ?? 'Or type a channel name above'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
