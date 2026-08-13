import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, Copy } from 'lucide-react';
import { CodeBlock, type CustomRendererProps } from 'streamdown';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

const COPY_FEEDBACK_DURATION_MS = 2000;
const CODE_META_FILE_RE =
  /\b(?:title|filename|file|path)=("([^"]+)"|'([^']+)'|([^\s]+))/i;
const CODE_META_PATH_TOKEN_RE =
  /^(?:\.{0,2}\/)?(?:[\w@.-]+\/)*[\w@.-]+\.[A-Za-z0-9]{1,10}$/;

export function TaskV2CodeCard({
  code,
  language,
  isIncomplete,
  meta,
}: CustomRendererProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const filename = useMemo(() => extractCodeFilename(meta), [meta]);
  const displayLanguage =
    language.trim().toLowerCase() || t.task.codeCardLanguageFallback;

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await copyText(code);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_DURATION_MS,
      );
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <div
      className="not-prose border-border bg-card text-card-foreground my-4 overflow-hidden rounded-lg border"
      data-incomplete={isIncomplete || undefined}
      data-testid="assistant-code-card"
    >
      <div className="border-border bg-muted/40 flex min-h-10 items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-xs font-medium">
            {filename ?? t.task.codeCardTitle}
          </span>
          <span className="border-border bg-background text-muted-foreground shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px]">
            {displayLanguage}
          </span>
          {isIncomplete && (
            <span className="bg-primary/10 text-primary shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium">
              {t.task.codeCardStreaming}
            </span>
          )}
        </div>

        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className={cn(
                  'text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors',
                  copied && 'text-green-500 hover:text-green-500',
                )}
                aria-label={copied ? t.task.copied : t.task.copyCode}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {copied ? t.task.copied : t.task.copyCode}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="[&_[data-streamdown='code-block-body']]:bg-background [&_[data-streamdown='code-block']]:my-0 [&_[data-streamdown='code-block']]:rounded-none [&_[data-streamdown='code-block']]:border-0 [&_[data-streamdown='code-block']]:bg-transparent [&_[data-streamdown='code-block']]:p-0 [&_[data-streamdown='code-block-body']]:rounded-none [&_[data-streamdown='code-block-body']]:border-0 [&_[data-streamdown='code-block-body']]:p-3 [&_[data-streamdown='code-block-header']]:hidden">
        <CodeBlock
          code={code}
          isIncomplete={isIncomplete}
          language={language || 'text'}
        />
      </div>
    </div>
  );
}

function extractCodeFilename(meta?: string) {
  const trimmed = meta?.trim();
  if (!trimmed) return undefined;
  const namedMatch = trimmed.match(CODE_META_FILE_RE);
  const namedValue =
    namedMatch?.[2] ?? namedMatch?.[3] ?? namedMatch?.[4] ?? '';
  const tokenValue =
    namedValue ||
    trimmed
      .split(/\s+/)
      .map((token) => token.replace(/^["']|["']$/g, ''))
      .find(
        (token) =>
          !token.includes('=') &&
          !token.startsWith('{') &&
          CODE_META_PATH_TOKEN_RE.test(token),
      );
  const normalized = stripControlChars(tokenValue ?? '').trim();
  if (!normalized) return undefined;
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function stripControlChars(value: string) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}
