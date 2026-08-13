import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

export interface ChatPanelProps extends HTMLAttributes<HTMLElement> {
  'aria-label': string;
  border?: 'left' | 'right' | 'none';
  children: ReactNode;
}

function ChatPanelRoot({
  'aria-label': ariaLabel,
  border = 'right',
  className,
  children,
  ...props
}: ChatPanelProps) {
  return (
    <aside
      aria-label={ariaLabel}
      className={cn(
        'border-border bg-background flex h-full min-h-0 flex-col',
        border === 'right' && 'border-r',
        border === 'left' && 'border-l',
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export interface ChatPanelHeaderProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  actions?: ReactNode;
}

function ChatPanelHeader({
  children,
  actions,
  className,
  ...props
}: ChatPanelHeaderProps) {
  return (
    <header
      className={cn(
        'border-border flex items-start justify-between gap-3 border-b p-4',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">{children}</div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}

export interface ChatPanelMessagesRef {
  scrollToBottom: () => void;
  element: HTMLDivElement | null;
}

export interface ChatPanelMessagesProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  autoScrollKey?: unknown;
  followOutput?: boolean;
  virtualized?: boolean;
}

const ChatPanelMessages = forwardRef<
  ChatPanelMessagesRef,
  ChatPanelMessagesProps
>(function ChatPanelMessages(
  {
    children,
    autoScrollKey,
    followOutput = false,
    virtualized = false,
    className,
    ...props
  },
  ref,
) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const node = innerRef.current;
      if (!node || virtualized) return;
      if (typeof node.scrollTo === 'function') {
        node.scrollTo({ top: node.scrollHeight, behavior });
      } else {
        node.scrollTop = node.scrollHeight;
      }
    },
    [virtualized],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom,
      get element() {
        return innerRef.current;
      },
    }),
    [scrollToBottom],
  );

  useEffect(() => {
    scrollToBottom();
  }, [autoScrollKey, scrollToBottom]);

  useEffect(() => {
    if (followOutput) scrollToBottom('auto');
  }, [children, followOutput, scrollToBottom]);

  return (
    <div
      ref={innerRef}
      className={cn(
        'min-h-0 flex-1',
        virtualized ? 'overflow-hidden' : 'space-y-3 overflow-auto p-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export interface ChatPanelComposerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function ChatPanelComposer({
  children,
  className,
  ...props
}: ChatPanelComposerProps) {
  return (
    <div className={cn('border-border border-t', className)} {...props}>
      {children}
    </div>
  );
}

export interface ChatPanelEmptyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  show?: boolean;
}

function ChatPanelEmpty({
  children,
  show = true,
  className,
  ...props
}: ChatPanelEmptyProps) {
  if (!show) return null;
  return (
    <div
      className={cn(
        'text-muted-foreground flex min-h-0 flex-1 items-center justify-center p-6 text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export const ChatPanel = Object.assign(ChatPanelRoot, {
  Header: ChatPanelHeader,
  Messages: ChatPanelMessages,
  Composer: ChatPanelComposer,
  Empty: ChatPanelEmpty,
});
