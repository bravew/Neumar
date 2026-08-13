import type { ChannelButton } from '../../types';
import type { InteractiveBlock } from '../interactive';

export type PresentationKind = 'message';

export interface Presentation {
  kind: PresentationKind;
  text: string;
  blocks: InteractiveBlock[];
  buttons: ChannelButton[];
  attachments?: string[];
}

export interface CapabilityProfile {
  platform: string;
  supportsButtons: boolean;
  supportsForms: boolean;
  supportsSelects: boolean;
  supportsDatePicker: boolean;
  supportsImageAttachment: boolean;
  supportsFileAttachment: boolean;
  maxButtons: number;
  maxOptions: number;
  maxMessageLength: number;
}

export interface RenderedPresentation extends Presentation {
  profile: CapabilityProfile;
  degradedBlocks: InteractiveBlock[];
  degradedReason?: string;
}
