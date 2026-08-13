import { useEffect, useMemo, useState } from 'react';

import { CheckCircle2, Download, Send, Share2, XCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoExportDestination,
  VideoProject,
  VideoRenderOutput,
  VideoShareResult,
} from '@/shared/types/video';

type ChannelDestination = Extract<
  VideoExportDestination,
  'slack' | 'discord' | 'telegram' | 'lark'
>;
type SocialDestination = Extract<VideoExportDestination, 'youtube' | 'tiktok'>;

interface ShareModalProps {
  project: VideoProject;
  aspect: VideoAspectRatio;
  output?: VideoRenderOutput;
  outputUrl?: string;
}

interface ChannelConfig {
  id: string;
  platform: string;
  name?: string | null;
  configured?: boolean;
}

interface ChannelStatus {
  platform: string;
  name: string | null;
  state: string;
  capabilities?: { supportsFileUpload?: boolean };
}

const CHANNEL_DESTINATIONS: ChannelDestination[] = [
  'slack',
  'discord',
  'telegram',
  'lark',
];
const SOCIAL_DESTINATIONS: SocialDestination[] = ['youtube', 'tiktok'];

export function ShareModal({
  project,
  aspect,
  output,
  outputUrl,
}: ShareModalProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] =
    useState<VideoExportDestination>('download-mp4');
  const [configs, setConfigs] = useState<ChannelConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>({});
  const [channelConfigId, setChannelConfigId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [message, setMessage] = useState('');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoShareResult | null>(null);
  const destinationIsChannel = isChannelDestination(destination);
  const channelConfigs = useMemo(
    () =>
      configs.filter((config) => {
        const status = statuses[config.id];
        return (
          isChannelDestination(config.platform) &&
          config.configured &&
          status?.state === 'running' &&
          status.capabilities?.supportsFileUpload !== false
        );
      }),
    [configs, statuses],
  );
  const matchingChannelConfigs = useMemo(
    () => channelConfigs.filter((config) => config.platform === destination),
    [channelConfigs, destination],
  );
  const canShareChannel =
    destinationIsChannel &&
    Boolean(channelConfigId && conversationId.trim() && output);
  const selectedChannel = matchingChannelConfigs.find(
    (config) => config.id === channelConfigId,
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadChannels(controller.signal).then(({ configs, statuses }) => {
      if (controller.signal.aborted) return;
      setConfigs(configs);
      setStatuses(statuses);
      const first = configs.find((config) => {
        const status = statuses[config.id];
        return (
          isChannelDestination(config.platform) &&
          config.configured &&
          status?.state === 'running' &&
          status.capabilities?.supportsFileUpload !== false
        );
      });
      if (first) {
        setDestination(first.platform as ChannelDestination);
        setChannelConfigId(first.id);
      }
    });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!destinationIsChannel) return;
    if (selectedChannel) return;
    setChannelConfigId(matchingChannelConfigs[0]?.id ?? '');
  }, [destinationIsChannel, matchingChannelConfigs, selectedChannel]);

  const handleShare = async () => {
    if (!canShareChannel) return;
    setSharing(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/video/projects/${encodeURIComponent(project.id)}/share`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination,
            aspectRatio: aspect,
            channelConfigId,
            conversationId,
            message,
          }),
        },
      );
      const data = (await response.json()) as {
        share?: VideoShareResult;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      setResult(data.share ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={!output}
          className="border-border hover:bg-accent inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
        >
          <Share2 className="size-3" />
          {t.video.editor.share.open}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.video.editor.share.title}</DialogTitle>
          <DialogDescription>
            {t.video.editor.share.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!output ? (
            <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
              {t.video.editor.share.noOutput}
            </div>
          ) : null}
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t.video.editor.share.destination}
            </span>
            <select
              value={destination}
              onChange={(event) => {
                setDestination(event.target.value as VideoExportDestination);
                setResult(null);
                setError(null);
              }}
              className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="download-mp4">
                {t.video.editor.share.downloadMp4}
              </option>
              {CHANNEL_DESTINATIONS.map((nextDestination) => (
                <option key={nextDestination} value={nextDestination}>
                  {t.video.editor.share[nextDestination]}
                </option>
              ))}
              {SOCIAL_DESTINATIONS.map((nextDestination) => (
                <option key={nextDestination} value={nextDestination} disabled>
                  {t.video.editor.share[nextDestination]}
                </option>
              ))}
            </select>
          </label>
          {destination === 'download-mp4' ? (
            <a
              href={outputUrl}
              download
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Download className="size-4" />
              {t.video.editor.share.download}
            </a>
          ) : null}
          {destinationIsChannel ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t.video.editor.share.channel}
                </span>
                <select
                  value={channelConfigId}
                  onChange={(event) => {
                    setChannelConfigId(event.target.value);
                    setResult(null);
                    setError(null);
                  }}
                  className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
                >
                  {matchingChannelConfigs.length === 0 ? (
                    <option value="">{t.video.editor.share.unavailable}</option>
                  ) : (
                    matchingChannelConfigs.map((config) => (
                      <option key={config.id} value={config.id}>
                        {config.name || config.platform}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t.video.editor.share.conversationId}
                </span>
                <input
                  value={conversationId}
                  onChange={(event) => {
                    setConversationId(event.target.value);
                    setResult(null);
                    setError(null);
                  }}
                  placeholder={t.video.editor.share.conversationId}
                  className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-muted-foreground mb-1 block text-xs font-medium">
                  {t.video.editor.share.message}
                </span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t.video.editor.share.messagePlaceholder}
                  className="border-border bg-background min-h-20 w-full resize-none rounded-md border px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}
          {error ? (
            <div className="text-destructive flex items-center gap-2 text-sm">
              <XCircle className="size-4" />
              <span>{error}</span>
            </div>
          ) : null}
          {result ? (
            <div className="text-success flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4" />
              <span>{t.video.editor.share.sent}</span>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {destinationIsChannel ? (
            <button
              type="button"
              disabled={!canShareChannel || sharing}
              onClick={() => void handleShare()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm disabled:opacity-50"
            >
              <Send className="size-4" />
              {sharing
                ? t.video.editor.share.sending
                : t.video.editor.share.send}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isChannelDestination(value: string): value is ChannelDestination {
  return CHANNEL_DESTINATIONS.includes(value as ChannelDestination);
}

async function loadChannels(signal: AbortSignal): Promise<{
  configs: ChannelConfig[];
  statuses: Record<string, ChannelStatus>;
}> {
  const [configsResponse, statusResponse] = await Promise.all([
    fetch(`${API_BASE_URL}/channels/configs`, { signal }),
    fetch(`${API_BASE_URL}/channels/status`, { signal }),
  ]);
  const configsData = configsResponse.ok
    ? ((await configsResponse.json()) as { configs?: ChannelConfig[] })
    : {};
  const statusData = statusResponse.ok
    ? ((await statusResponse.json()) as {
        status?: Record<string, ChannelStatus>;
      })
    : {};
  return {
    configs: configsData.configs ?? [],
    statuses: statusData.status ?? {},
  };
}
