/**
 * Speech Settings Tab
 *
 * MCP-style tab layout: TTS | STT | Conversation
 * Owns shared state (local model status + polling) and renders
 * sub-sections in separate tabs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { SettingsTabProps } from '../types';
import { ConversationModeSection } from './speech/ConversationModeSection';
import { SttSection } from './speech/SttSection';
import { TtsSection } from './speech/TtsSection';
import type { LocalModelStatus, TtsModelKey } from './speech/types';

const POLL_INTERVAL = 2_000;
/** Stop polling after 30 minutes to avoid indefinite polling on stuck downloads. */
const MAX_POLL_DURATION_MS = 30 * 60 * 1_000;

type SpeechTab = 'tts' | 'stt' | 'conversation';

function isInProgress(status: LocalModelStatus): boolean {
  const { stt, tts } = status;
  return (
    stt.state === 'downloading' ||
    stt.state === 'loading' ||
    tts.kokoro.state === 'downloading' ||
    tts.kokoro.state === 'loading' ||
    tts.pocket.state === 'downloading' ||
    tts.pocket.state === 'loading' ||
    tts.kitten.state === 'downloading' ||
    tts.kitten.state === 'loading'
  );
}

export function SpeechSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<SpeechTab>('tts');
  const [localStatus, setLocalStatus] = useState<LocalModelStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);

  // Fetch local model status on mount
  useEffect(() => {
    const controller = new AbortController();
    async function fetchStatus() {
      try {
        const res = await fetch(`${API_BASE_URL}/speech/local/status`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data: LocalModelStatus = await res.json();
          setLocalStatus(data);
          if (isInProgress(data)) setPolling(true);
        }
      } catch {
        /* endpoint may not be available or aborted */
      }
    }
    fetchStatus();
    return () => controller.abort();
  }, []);

  // Poll while a model is downloading or loading
  useEffect(() => {
    if (!polling) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    let mounted = true;
    pollStartRef.current = Date.now();

    pollRef.current = setInterval(async () => {
      if (
        !mounted ||
        Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS
      ) {
        setPolling(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE_URL}/speech/local/status`);
        if (!mounted) return;
        if (res.ok) {
          const data: LocalModelStatus = await res.json();
          if (!mounted) return;
          setLocalStatus(data);
          if (!isInProgress(data)) setPolling(false);
        }
      } catch {
        if (mounted) setPolling(false);
      }
    }, POLL_INTERVAL);

    return () => {
      mounted = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [polling]);

  const triggerDownload = useCallback(async (model: 'stt' | TtsModelKey) => {
    try {
      await fetch(`${API_BASE_URL}/speech/local/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      setLocalStatus((prev) => {
        if (!prev) return prev;
        if (model === 'stt') {
          return {
            ...prev,
            stt: {
              ...prev.stt,
              state: 'downloading' as const,
              downloadProgress: { downloadedBytes: 0, totalBytes: 0 },
            },
          };
        }
        return {
          ...prev,
          tts: {
            ...prev.tts,
            [model]: {
              ...prev.tts[model],
              state: 'downloading' as const,
              downloadProgress: { downloadedBytes: 0, totalBytes: 0 },
            },
          },
        };
      });
      setPolling(true);
    } catch {
      /* endpoint may not be available */
    }
  }, []);

  const tabs: { key: SpeechTab; label: string }[] = [
    { key: 'tts', label: t.settings.speechTts ?? 'Text-to-Speech' },
    { key: 'stt', label: t.settings.speechStt ?? 'Speech-to-Text' },
    {
      key: 'conversation',
      label: t.settings.speechConversationMode ?? 'Conversation',
    },
  ];

  return (
    <div className="-m-6 flex h-[calc(100%+48px)] flex-col">
      {/* Tab Bar */}
      <div className="border-border shrink-0 border-b px-6">
        <div className="flex items-center gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {activeTab === 'tts' && (
          <TtsSection
            settings={settings}
            onSettingsChange={onSettingsChange}
            localStatus={localStatus}
            onDownload={triggerDownload}
          />
        )}
        {activeTab === 'stt' && (
          <SttSection
            settings={settings}
            onSettingsChange={onSettingsChange}
            localStatus={localStatus}
            onDownload={triggerDownload}
          />
        )}
        {activeTab === 'conversation' && (
          <ConversationModeSection
            settings={settings}
            onSettingsChange={onSettingsChange}
          />
        )}
      </div>
    </div>
  );
}
