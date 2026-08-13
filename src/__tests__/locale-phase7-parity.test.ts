import { describe, expect, it } from 'vitest';

import enArtifacts from '@/config/locale/messages/en/artifacts';
import enAutomation from '@/config/locale/messages/en/automation';
import enConnectors from '@/config/locale/messages/en/connectors';
import enDesign from '@/config/locale/messages/en/design';
import enModes from '@/config/locale/messages/en/modes';
import enPlugins from '@/config/locale/messages/en/plugins';
import enSettings from '@/config/locale/messages/en/settings';
import esArtifacts from '@/config/locale/messages/es/artifacts';
import esAutomation from '@/config/locale/messages/es/automation';
import esConnectors from '@/config/locale/messages/es/connectors';
import esDesign from '@/config/locale/messages/es/design';
import esModes from '@/config/locale/messages/es/modes';
import esPlugins from '@/config/locale/messages/es/plugins';
import esSettings from '@/config/locale/messages/es/settings';
import frArtifacts from '@/config/locale/messages/fr/artifacts';
import frAutomation from '@/config/locale/messages/fr/automation';
import frConnectors from '@/config/locale/messages/fr/connectors';
import frDesign from '@/config/locale/messages/fr/design';
import frModes from '@/config/locale/messages/fr/modes';
import frPlugins from '@/config/locale/messages/fr/plugins';
import frSettings from '@/config/locale/messages/fr/settings';
import hiArtifacts from '@/config/locale/messages/hi/artifacts';
import hiAutomation from '@/config/locale/messages/hi/automation';
import hiConnectors from '@/config/locale/messages/hi/connectors';
import hiDesign from '@/config/locale/messages/hi/design';
import hiModes from '@/config/locale/messages/hi/modes';
import hiPlugins from '@/config/locale/messages/hi/plugins';
import hiSettings from '@/config/locale/messages/hi/settings';
import ptArtifacts from '@/config/locale/messages/pt/artifacts';
import ptAutomation from '@/config/locale/messages/pt/automation';
import ptConnectors from '@/config/locale/messages/pt/connectors';
import ptDesign from '@/config/locale/messages/pt/design';
import ptModes from '@/config/locale/messages/pt/modes';
import ptPlugins from '@/config/locale/messages/pt/plugins';
import ptSettings from '@/config/locale/messages/pt/settings';
import zhArtifacts from '@/config/locale/messages/zh/artifacts';
import zhAutomation from '@/config/locale/messages/zh/automation';
import zhConnectors from '@/config/locale/messages/zh/connectors';
import zhDesign from '@/config/locale/messages/zh/design';
import zhModes from '@/config/locale/messages/zh/modes';
import zhPlugins from '@/config/locale/messages/zh/plugins';
import zhSettings from '@/config/locale/messages/zh/settings';

const localeBundles = {
  en: {
    artifacts: enArtifacts,
    automation: enAutomation,
    connectors: enConnectors,
    design: enDesign,
    modes: enModes,
    plugins: enPlugins,
    settings: enSettings,
  },
  zh: {
    artifacts: zhArtifacts,
    automation: zhAutomation,
    connectors: zhConnectors,
    design: zhDesign,
    modes: zhModes,
    plugins: zhPlugins,
    settings: zhSettings,
  },
  es: {
    artifacts: esArtifacts,
    automation: esAutomation,
    connectors: esConnectors,
    design: esDesign,
    modes: esModes,
    plugins: esPlugins,
    settings: esSettings,
  },
  fr: {
    artifacts: frArtifacts,
    automation: frAutomation,
    connectors: frConnectors,
    design: frDesign,
    modes: frModes,
    plugins: frPlugins,
    settings: frSettings,
  },
  hi: {
    artifacts: hiArtifacts,
    automation: hiAutomation,
    connectors: hiConnectors,
    design: hiDesign,
    modes: hiModes,
    plugins: hiPlugins,
    settings: hiSettings,
  },
  pt: {
    artifacts: ptArtifacts,
    automation: ptAutomation,
    connectors: ptConnectors,
    design: ptDesign,
    modes: ptModes,
    plugins: ptPlugins,
    settings: ptSettings,
  },
};

const requiredPhase7Paths = {
  artifacts: ['comingSoon'],
  automation: [
    'fields.intervalMinutes',
    'manual.description',
    'scheduleSummary.manual',
  ],
  connectors: [
    'catalog.searchPlaceholder',
    'card.openLabel',
    'composioCard.customAuthNotice',
    'detail.fallbackTitle',
  ],
  design: [
    'bulkDelete.success',
    'bulkDelete.error',
    'composerHint',
    'manualEditApply',
    'routines.title',
  ],
  modes: ['chat.comingSoonTitle', 'chat.comingSoonDescription'],
  plugins: ['actions.install', 'actions.uninstall', 'card.skillsCount'],
  settings: ['integrationSlack', 'providerTGIDesc'],
};

describe('Phase 7 locale coverage', () => {
  it('keeps the polished surfaces present across all six locales', () => {
    for (const [locale, bundle] of Object.entries(localeBundles)) {
      for (const [namespace, paths] of Object.entries(requiredPhase7Paths)) {
        for (const path of paths) {
          expect(
            getPath(bundle[namespace as keyof typeof bundle], path),
            `${locale}.${namespace}.${path}`,
          ).toEqual(expect.any(String));
        }
      }
    }
  });

  it('uses explicit zh translations for the new DesignMode strings', () => {
    for (const path of [
      'bulkDelete.success',
      'bulkDelete.error',
      'composerHint',
    ]) {
      expect(getPath(zhDesign, path)).not.toBe(getPath(enDesign, path));
    }
  });
});

function getPath(source: unknown, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}
