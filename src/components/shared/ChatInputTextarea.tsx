import type {
  ChangeEvent,
  ClipboardEvent,
  CompositionEvent,
  KeyboardEvent,
  RefObject,
} from 'react';

import { cn } from '@/shared/lib/utils';

import {
  TEXTAREA_MAX_HEIGHT_HOME,
  TEXTAREA_MAX_HEIGHT_REPLY,
  TEXTAREA_MIN_HEIGHT_HOME,
  TEXTAREA_MIN_HEIGHT_REPLY,
} from './ChatInput.types';

interface ChatInputTextareaProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  placeholder: string;
  isHome: boolean;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}

export function ChatInputTextarea({
  textareaRef,
  value,
  placeholder,
  isHome,
  disabled,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onPaste,
}: ChatInputTextareaProps) {
  return (
    <textarea
      data-testid="chat-input-textarea"
      ref={textareaRef}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onPaste={onPaste}
      placeholder={placeholder}
      className={cn(
        'text-foreground placeholder:text-muted-foreground w-full resize-none border-0 bg-transparent py-0 focus:outline-none',
        isHome ? 'text-base' : 'px-1 text-sm',
      )}
      style={{
        minHeight: `${isHome ? TEXTAREA_MIN_HEIGHT_HOME : TEXTAREA_MIN_HEIGHT_REPLY}px`,
        maxHeight: `${isHome ? TEXTAREA_MAX_HEIGHT_HOME : TEXTAREA_MAX_HEIGHT_REPLY}px`,
        overflowY: 'hidden',
      }}
      rows={1}
      disabled={disabled}
    />
  );
}
