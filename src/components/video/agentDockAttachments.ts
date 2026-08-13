import {
  isAudioFile,
  isImageFile,
  isVideoFile,
} from '@/components/shared/ChatInput.types';
import type { MessageAttachment } from '@/shared/hooks/agent-types';

export const VIDEO_AGENT_ATTACHMENT_ACCEPT = 'image/*,video/*,audio/*';

export function isVideoAgentAttachment(file: File): boolean {
  return isImageFile(file) || isVideoFile(file) || isAudioFile(file);
}

export function attachmentFiles(attachments?: MessageAttachment[]): File[] {
  return (attachments ?? [])
    .map((attachment) => attachment.file)
    .filter((file): file is File => Boolean(file));
}
