import type { ChannelCapabilities } from '../../types';
import type { CapabilityProfile } from './types';

const DEFAULT_MAX_BUTTONS = 25;
const DEFAULT_MAX_OPTIONS = 100;

export function capabilityProfileFor(
  platform: string,
  capabilities: ChannelCapabilities,
): CapabilityProfile {
  return {
    platform,
    supportsButtons: capabilities.supportsButtons,
    supportsForms:
      capabilities.supportsModals ||
      capabilities.supportsSelects ||
      capabilities.supportsButtons,
    supportsSelects: capabilities.supportsSelects,
    supportsDatePicker: capabilities.supportsDatePicker,
    supportsImageAttachment: capabilities.supportsFileUpload,
    supportsFileAttachment: capabilities.supportsFileUpload,
    maxButtons: DEFAULT_MAX_BUTTONS,
    maxOptions: DEFAULT_MAX_OPTIONS,
    maxMessageLength: capabilities.maxMessageLength,
  };
}
