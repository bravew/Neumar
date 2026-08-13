import type { ReactNode } from 'react';
import { useState } from 'react';

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { Maximize2 } from 'lucide-react';
import { Streamdown } from 'streamdown';

import type { TaskPlan } from '@/shared/hooks/agent-types';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { preprocessMarkdown } from '@/shared/lib/markdown-utils';
import { parseSkillAnchor } from '@/shared/lib/skill-anchor';
import { parseStructuredEnvelope } from '@/shared/utils/structured-envelope';

import { ErrorMessage } from './ErrorMessage';
import { ImmichPublishedMediaPreviews } from './ImmichPublishedMediaPreview';
import { TAURI_LINK_SAFETY } from './LinkSafetyModal';
import { MediaLightbox } from './MediaLightbox';
import { MessageToolbar } from './MessageToolbar';
import { PlanApproval } from './PlanApproval';
import { SkillAnchorBadge } from './SkillAnchorBadge';
import { UserMessage } from './UserMessage';

// Module-level constants to avoid recreating on every render (prevents Streamdown re-renders)
const STREAMDOWN_PLUGINS = { code, math, mermaid, cjk };

const LinkComponent = ({
  children,
  href,
}: {
  children?: ReactNode;
  href?: string;
}) => (
  <a
    href={href}
    onClick={async (e) => {
      e.preventDefault();
      if (href) {
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(href);
        } catch {
          window.open(href, '_blank');
        }
      }
    }}
    className="text-primary cursor-pointer hover:underline"
  >
    {children}
  </a>
);

const TableComponent = ({ children }: { children?: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="border-border border-collapse border">{children}</table>
  </div>
);

const ThComponent = ({ children }: { children?: ReactNode }) => (
  <th className="border-border bg-muted border px-3 py-2 text-left">
    {children}
  </th>
);

const TdComponent = ({ children }: { children?: ReactNode }) => (
  <td className="border-border border px-3 py-2">{children}</td>
);

// Max height 320px — standard for chat images (Telegram/Slack range 300–360px)
function ImgComponent({ src, alt }: { src?: string; alt?: string }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <img
        src={src}
        alt={alt}
        className="max-h-80 max-w-full cursor-zoom-in rounded-lg object-contain"
        onClick={() => setOpen(true)}
        title="Click to view full size"
      />
      {open && (
        <MediaLightbox
          src={src}
          alt={alt}
          type="image"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Max height 288px for videos in chat, expand button for fullscreen
function VideoComponent({ src }: { src?: string }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <div className="group/video relative inline-block">
        <video
          src={src}
          controls
          className="max-h-72 max-w-full rounded-lg bg-black"
        />
        <button
          className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity group-hover/video:opacity-100"
          onClick={() => setOpen(true)}
          title="View full size"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      {open && (
        <MediaLightbox src={src} type="video" onClose={() => setOpen(false)} />
      )}
    </>
  );
}

const STREAMDOWN_COMPONENTS = {
  a: LinkComponent,
  img: ImgComponent,
  table: TableComponent,
  td: TdComponent,
  th: ThComponent,
  video: VideoComponent,
};

export function MessageItem({
  message,
  phase,
  autoExecutePlan,
  onApprovePlan,
  onRejectPlan,
  onRetry,
  onResume,
  cost,
  usage,
}: {
  message: AgentMessage;
  phase?: string;
  autoExecutePlan?: boolean;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
  onRetry?: () => void;
  onResume?: () => void;
  cost?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}) {
  if (message.type === 'user') {
    return (
      <UserMessage
        content={message.content || ''}
        attachments={message.attachments}
        subtype={message.subtype}
      />
    );
  }

  if (message.type === 'plan' && message.plan) {
    return (
      <PlanApproval
        plan={message.plan}
        isWaitingApproval={phase === 'awaiting_approval'}
        autoExecute={autoExecutePlan}
        onApprove={onApprovePlan}
        onReject={onRejectPlan}
      />
    );
  }

  if (message.type === 'text') {
    const envelope = parseStructuredEnvelope(message.content || '');
    if (envelope?.type === 'plan') {
      return (
        <PlanApproval
          plan={envelope.value as unknown as TaskPlan}
          isWaitingApproval={phase === 'awaiting_approval'}
          autoExecute={autoExecutePlan}
          onApprove={onApprovePlan}
          onReject={onRejectPlan}
        />
      );
    }

    const rawContent =
      envelope?.type === 'direct_answer'
        ? envelope.answer
        : message.content || '';
    // Lift a plugin-injected `Skill: <slug>` anchor out of the body and show it
    // as a quiet badge instead of rendering it as plain text.
    const { skill: skillAnchor, body: displayContent } =
      parseSkillAnchor(rawContent);
    const processedContent = preprocessMarkdown(displayContent);

    return (
      <div className="border-ai-response group relative rounded-xl border-l-2 pl-3">
        <div className="flex min-w-0 flex-col gap-3">
          {skillAnchor ? <SkillAnchorBadge skill={skillAnchor} /> : null}
          <div className="prose prose-sm text-foreground max-w-none min-w-0 flex-1 break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto">
            <Streamdown
              plugins={STREAMDOWN_PLUGINS}
              animated
              components={STREAMDOWN_COMPONENTS}
              linkSafety={TAURI_LINK_SAFETY}
            >
              {processedContent}
            </Streamdown>
          </div>
          <ImmichPublishedMediaPreviews content={displayContent} />
        </div>
        <MessageToolbar
          content={displayContent}
          cost={cost}
          usage={usage}
          onRetry={onRetry}
          onResume={onResume}
        />
      </div>
    );
  }

  if (message.type === 'result') {
    return null;
  }

  if (message.type === 'error') {
    return (
      <ErrorMessage message={message.message || ''} subtype={message.subtype} />
    );
  }

  return null;
}
