import { getSetting } from '@/shared/db/operations';

import { getAllExtensions } from './registry.js';
import type { SkillContribution } from './types.js';

export interface ExtensionContext {
  getSetting(key: string): string | null;
  showNotification(message: string): void;
  registerSkill(skill: SkillContribution): void;
}

export function createExtensionContext(extensionId: string): ExtensionContext {
  return {
    getSetting(key: string): string | null {
      return getSetting(key as Parameters<typeof getSetting>[0]);
    },
    showNotification(message: string): void {
      // Notification system integration point — no-op in skeleton
      void message;
    },
    registerSkill(skill: SkillContribution): void {
      const existing = getAllExtensions().find(
        (e) => e.manifest.id === extensionId,
      );
      if (!existing) return;
      if (!existing.manifest.contributes.skills) {
        existing.manifest.contributes.skills = [];
      }
      existing.manifest.contributes.skills.push(skill);
    },
  };
}
