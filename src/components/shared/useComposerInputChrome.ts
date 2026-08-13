import { useEffect, type RefObject } from 'react';

import { useShortcut } from '@/shared/hotkeys/useShortcut';
import { useOptionalMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  TEXTAREA_MAX_HEIGHT_HOME,
  TEXTAREA_MAX_HEIGHT_REPLY,
  TEXTAREA_MIN_HEIGHT_HOME,
  TEXTAREA_MIN_HEIGHT_REPLY,
} from './ChatInput.types';

export function useComposerPlaceholder(
  explicitPlaceholder: string | undefined,
  fallback: string,
) {
  const modeContext = useOptionalMode();
  const { tt } = useLanguage();
  const modePlaceholderKey = modeContext?.activeMode.composer?.placeholderKey;
  return (
    explicitPlaceholder ??
    (modePlaceholderKey ? tt(modePlaceholderKey) : undefined) ??
    fallback
  );
}

export function useComposerModelShortcut({
  disabled,
  isRunning,
  enabled,
  triggerRef,
}: {
  disabled: boolean;
  isRunning: boolean;
  enabled: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  useShortcut({
    id: 'composer.modelPicker.open',
    chord: 'mod+shift+i',
    scope: 'global',
    descriptionKey: 'shortcuts.modelPicker.description',
    group: 'composer',
    ignoreInEditable: false,
    handler: () => {
      if (!disabled && !isRunning && enabled) triggerRef.current?.click();
    },
  });
}

export function useComposerTextareaResize({
  textareaRef,
  isHome,
  value,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isHome: boolean;
  value: string;
}) {
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = isHome
      ? TEXTAREA_MAX_HEIGHT_HOME
      : TEXTAREA_MAX_HEIGHT_REPLY;
    const minHeight = isHome
      ? TEXTAREA_MIN_HEIGHT_HOME
      : TEXTAREA_MIN_HEIGHT_REPLY;
    const newHeight = Math.min(
      Math.max(textarea.scrollHeight, minHeight),
      maxHeight,
    );
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value, isHome, textareaRef]);
}
