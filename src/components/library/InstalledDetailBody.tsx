/**
 * InstalledDetailBody — the scrollable content of the plugin detail dialog for
 * an INSTALLED plugin, sourced from the local install record + manifest:
 * author, about, example query, context bundles (what it pulls in at apply
 * time), capability permissions, and the provenance/source table. Mirrors Open
 * Design's installed detail.
 */

import type { AvailablePluginEntry } from '@/shared/hooks/useMarketplaceSources';
import type { InstalledPlugin } from '@/shared/hooks/usePlugins';
import { useLanguage } from '@/shared/providers/language-provider';

import { authorName, safeUrl } from './detail-helpers';
import {
  Chips,
  CopyButton,
  Field,
  Link,
  Row,
  Section,
  TrustBadge,
} from './DetailPrimitives';

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function InstalledDetailBody({
  plugin,
  entry,
}: {
  plugin: InstalledPlugin;
  entry: AvailablePluginEntry | null;
}) {
  const { t } = useLanguage();
  const manifest = plugin.manifest;
  const neuma = manifest?.metadata?.neuma;
  const about = manifest?.description || entry?.entry.description;
  const exampleQuery = neuma?.exampleQuery;
  const bundles = neuma?.contextBundles;
  const capabilities = neuma?.capabilitiesSummary ?? [];
  const author = authorName(
    (manifest?.author as AvailablePluginEntry['entry']['author']) ??
      entry?.entry.author,
  );
  const homepage = safeUrl(manifest?.homepage ?? entry?.entry.homepage);
  const license = manifest?.license ?? entry?.entry.license;

  const bundleRows: Array<{ label: string; items: string[] }> = [
    { label: t.plugins.details.bundleSkills, items: bundles?.skills ?? [] },
    { label: t.plugins.details.bundleAssets, items: bundles?.assets ?? [] },
    { label: t.plugins.details.bundleMcp, items: bundles?.mcpServers ?? [] },
    {
      label: t.plugins.details.bundleDesignSystems,
      items: bundles?.designSystems ?? [],
    },
  ].filter((b) => b.items.length > 0);

  return (
    <>
      {author ? (
        <Section title={t.plugins.details.author}>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-foreground font-medium">{author.name}</span>
            {author.url ? <Link href={author.url} /> : null}
            {homepage ? (
              <Link href={homepage} label={t.plugins.details.homepage} />
            ) : null}
          </div>
        </Section>
      ) : null}

      {about ? (
        <Section title={t.plugins.details.about}>
          <p className="text-muted-foreground whitespace-pre-line">{about}</p>
        </Section>
      ) : null}

      {exampleQuery ? (
        <Section title={t.plugins.details.exampleQuery}>
          <p className="text-muted-foreground text-xs">
            {t.plugins.details.exampleQueryHint}
          </p>
          <div className="bg-muted/40 border-border text-foreground rounded-md border px-3 py-2 text-xs">
            {exampleQuery}
          </div>
          <CopyButton
            value={exampleQuery}
            label={t.plugins.details.copy}
            copiedLabel={t.plugins.details.copied}
          />
        </Section>
      ) : null}

      {bundleRows.length > 0 ? (
        <Section title={t.plugins.details.contextBundles}>
          <p className="text-muted-foreground text-xs">
            {t.plugins.details.contextBundlesHint}
          </p>
          <div className="flex flex-col gap-2">
            {bundleRows.map((bundle) => (
              <Field key={bundle.label} label={bundle.label}>
                <Chips items={bundle.items} mono />
              </Field>
            ))}
          </div>
        </Section>
      ) : null}

      {capabilities.length > 0 ? (
        <Section title={t.plugins.details.capabilities}>
          <p className="text-muted-foreground text-xs">
            {t.plugins.details.permissionsHint}
          </p>
          <Chips items={capabilities} mono />
        </Section>
      ) : null}

      <Section title={t.plugins.details.sourceHeading}>
        <dl className="flex flex-col gap-1.5">
          <Row
            label={t.plugins.details.origin}
            value={
              <span className="break-all">
                <span className="text-muted-foreground mr-1.5 uppercase">
                  {plugin.source}
                </span>
                {plugin.sourceRef ?? ''}
              </span>
            }
            mono
          />
          <Row label={t.plugins.details.path} value={plugin.installPath} mono />
          <Row label={t.plugins.details.version} value={`v${plugin.version}`} />
          {plugin.marketplaceTrust ? (
            <Row
              label={t.plugins.details.trust}
              value={<TrustBadge trust={plugin.marketplaceTrust} />}
            />
          ) : null}
          {plugin.sourceMarketplaceId ? (
            <Row
              label={t.plugins.details.marketplaceId}
              value={plugin.sourceMarketplaceId}
            />
          ) : null}
          {license ? (
            <Row label={t.plugins.details.license} value={license} />
          ) : null}
          <Row
            label={t.plugins.details.installedAt}
            value={formatDate(plugin.installedAt)}
          />
        </dl>
      </Section>
    </>
  );
}
