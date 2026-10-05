import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { MessageAttachment } from '@/shared/hooks/useAgent';

import type { Attachment, ChatInputProps } from './ChatInput.types';
import { expandSearchSlashCommand } from './ChatInput.types';

interface UseChatInputSubmitOptions {
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  selectedMcp: string[];
  setSelectedMcp: Dispatch<SetStateAction<string[]>>;
  selectedSkills: string[];
  setSelectedSkills: Dispatch<SetStateAction<string[]>>;
  convertToMessageAttachments: (
    attachments: Attachment[],
  ) => MessageAttachment[] | undefined;
  hasExternalSubmitContext: boolean;
  disabled: boolean;
  isListening: boolean;
  stopListening: () => void;
  pttActiveRef: RefObject<boolean>;
  onSubmit: ChatInputProps['onSubmit'];
  onDispatch?: ChatInputProps['onDispatch'];
}

const mergeUnique = (restored: string[], current: string[]) => [
  ...new Set([...restored, ...current]),
];

/**
 * Collects the composer draft, clears it, and hands it to `onSubmit` /
 * `onDispatch`. When the handler returns `false` (the message was not sent,
 * e.g. an attachment failed to upload) the draft is restored without
 * clobbering anything the user typed or attached in the meantime.
 */
export function useChatInputSubmit({
  value,
  setValue,
  attachments,
  setAttachments,
  selectedMcp,
  setSelectedMcp,
  selectedSkills,
  setSelectedSkills,
  convertToMessageAttachments,
  hasExternalSubmitContext,
  disabled,
  isListening,
  stopListening,
  pttActiveRef,
  onSubmit,
  onDispatch,
}: UseChatInputSubmitOptions) {
  const collectAndClear = () => {
    const text = expandSearchSlashCommand(value.trim());
    if (
      (!text && attachments.length === 0 && !hasExternalSubmitContext) ||
      disabled
    )
      return null;
    const draft = {
      value,
      attachments,
      mcp: selectedMcp,
      skills: selectedSkills,
    };
    const messageAttachments = convertToMessageAttachments(attachments);
    const mcpMentions = selectedMcp.length > 0 ? [...selectedMcp] : undefined;
    const pinned = selectedSkills.length > 0 ? [...selectedSkills] : undefined;
    setValue('');
    setAttachments([]);
    setSelectedMcp([]);
    setSelectedSkills([]);
    return { text, messageAttachments, mcpMentions, pinned, draft };
  };

  const send = async (handler: ChatInputProps['onSubmit'] | undefined) => {
    if (!handler) return;
    if (isListening) {
      pttActiveRef.current = false;
      stopListening();
    }
    const input = collectAndClear();
    if (!input) return;
    let sent = false;
    try {
      sent =
        (await handler(
          input.text,
          input.messageAttachments,
          input.mcpMentions,
          input.pinned,
        )) !== false;
    } finally {
      if (!sent) {
        const { draft } = input;
        setValue((current) =>
          current && draft.value
            ? `${draft.value}\n${current}`
            : draft.value || current,
        );
        setAttachments((current) => [...draft.attachments, ...current]);
        setSelectedMcp((current) => mergeUnique(draft.mcp, current));
        setSelectedSkills((current) => mergeUnique(draft.skills, current));
      }
    }
  };

  return {
    handleSubmit: () => send(onSubmit),
    handleDispatch: () => send(onDispatch),
  };
}
