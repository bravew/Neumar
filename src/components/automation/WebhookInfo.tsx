/**
 * WebhookInfo
 *
 * Displays webhook URL and bearer token with copy-to-clipboard functionality.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Check, Copy, Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const COPY_FEEDBACK_DURATION_MS = 2_000;

interface WebhookInfoProps {
  slug: string;
  token: string;
  className?: string;
}

export function WebhookInfo({ slug, token, className }: WebhookInfoProps) {
  const { t } = useLanguage();
  const [showToken, setShowToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
    };
  }, []);

  const webhookUrl = `${API_BASE_URL}/automation/hooks/${slug}`;

  const copyToClipboard = useCallback(
    async (text: string, type: 'url' | 'token') => {
      await navigator.clipboard.writeText(text);
      if (type === 'url') {
        setCopiedUrl(true);
        if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
        urlTimerRef.current = setTimeout(
          () => setCopiedUrl(false),
          COPY_FEEDBACK_DURATION_MS,
        );
      } else {
        setCopiedToken(true);
        if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
        tokenTimerRef.current = setTimeout(
          () => setCopiedToken(false),
          COPY_FEEDBACK_DURATION_MS,
        );
      }
    },
    [],
  );

  return (
    <div className={cn('space-y-3', className)}>
      {/* Webhook URL */}
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t.automation.webhook.url}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={webhookUrl}
            className="bg-muted text-foreground flex-1 rounded-md border px-3 py-1.5 font-mono text-sm"
            aria-label={t.automation.webhook.url}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copyToClipboard(webhookUrl, 'url')}
            aria-label={t.automation.webhook.copyUrl}
          >
            {copiedUrl ? (
              <Check className="size-4 text-green-500" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Bearer Token */}
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          {t.automation.webhook.token}
        </label>
        <div className="flex items-center gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            readOnly
            value={token}
            className="bg-muted text-foreground flex-1 rounded-md border px-3 py-1.5 font-mono text-sm"
            aria-label={t.automation.webhook.token}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowToken(!showToken)}
            aria-label={
              showToken
                ? t.automation.webhook.hideToken
                : t.automation.webhook.showToken
            }
          >
            {showToken ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copyToClipboard(token, 'token')}
            aria-label={t.automation.webhook.copyToken}
          >
            {copiedToken ? (
              <Check className="size-4 text-green-500" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
