import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

import type { ChatPanelRole } from './types';

export interface MessageBubbleProps {
  role: ChatPanelRole;
  children: ReactNode;
  className?: string;
}

export function MessageBubble({
  role,
  children,
  className,
}: MessageBubbleProps) {
  return (
    <div
      className={cn(
        'flex w-full',
        role === 'user' ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'min-w-0 text-xs break-words',
          role === 'user' &&
            'bg-user-message text-user-message-foreground w-fit max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2',
          role === 'assistant' &&
            'text-foreground w-full max-w-[92%] px-1 py-1',
          role === 'system' &&
            'border-border/50 bg-muted/40 text-muted-foreground max-w-[92%] rounded-md border border-dashed px-3 py-2',
          role === 'reasoning' &&
            'text-muted-foreground w-full max-w-[92%] px-1 py-1 italic',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
