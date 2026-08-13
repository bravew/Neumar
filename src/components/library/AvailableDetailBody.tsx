/**
 * AvailableDetailBody — the scrollable content of the plugin detail dialog for
 * a NOT-yet-installed catalog entry: provenance, about, workflow, live
 * pre-install inspection (skills, evals), catalog rows, and metadata. Sourced
 * from the remote catalog + inspection endpoint.
 */

import {
  usePluginInspection,
  type AvailablePluginEntry,
} from '@/shared/hooks/useMarketplaceSources';
import { useLanguage } from '@/shared/providers/language-provider';

import { safeUrl, sourceRef, authorName } from './detail-helpers';
import { Chips, Field, Link, Row, Section } from './DetailPrimitives';

export function AvailableDetailBody({
  entry,
}: {
  entry: AvailablePluginEntry;
}) {
  const { t } = useLanguage();
  const { inspection, loading } = usePluginInspection(
    entry.sourceId,
    entry.entry.name,
  );

  const meta = entry.entry;
  const neuma = meta.metadata?.neuma;
  const capabilities =
    inspection?.workflow?.capabilities ?? neuma?.capabilitiesSummary ?? [];
  const tags = meta.tags ?? meta.keywords ?? [];
  const homepage = safeUrl(meta.homepage);
  const catalogUrl = safeUrl(entry.sourceUrl);
  const publisher = authorName(meta.author);
  const workflow = inspection?.workflow;
  const ref = sourceRef(entry);
  const trustLabel =
    entry.sourceTrust === 'official'
      ? t.plugins.sources.trustOfficial
      : t.plugins.sources.trustRestricted;

  return (
    <>
      <Section title={t.plugins.details.provenance}>
        <code className="bg-muted text-muted-foreground block truncate rounded px-2 py-1.5 text-xs">
          {t.plugins.details.provenanceValue
            .replace('{source}', entry.sourceName)
            .replace('{trust}', trustLabel)
            .replace('{ref}', ref)}
        </code>
      </Section>

      {meta.description ? (
        <Section title={t.plugins.details.about}>
          <p className="text-muted-foreground whitespace-pre-line">
            {meta.description}
          </p>
        </Section>
      ) : null}

      {workflow && (workflow.mode || (workflow.inputs?.length ?? 0) > 0) ? (
        <Section title={t.plugins.details.workflow}>
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            {workflow.mode ? (
              <span>
                {workflow.kind ? `${workflow.kind} · ` : ''}
                {workflow.mode}
                {workflow.scenario ? ` · ${workflow.scenario}` : ''}
              </span>
            ) : null}
            {workflow.inputs && workflow.inputs.length > 0 ? (
              <Chips items={workflow.inputs} />
            ) : null}
            {workflow.pipeline && workflow.pipeline.length > 0 ? (
              <span>{workflow.pipeline.join(' → ')}</span>
            ) : null}
          </div>
        </Section>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground text-xs">
          {t.plugins.details.inspecting}
        </p>
      ) : null}

      {inspection && inspection.skills.length > 0 ? (
        <Section
          title={t.plugins.details.skillsHeading.replace(
            '{n}',
            String(inspection.skills.length),
          )}
        >
          <ul className="flex flex-col gap-2">
            {inspection.skills.map((skill) => (
              <li key={skill.path}>
                <div className="font-mono text-xs">{skill.name}</div>
                {skill.description ? (
                  <p className="text-muted-foreground text-xs">
                    {skill.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {inspection?.evals ? (
        <Section
          title={t.plugins.details.evals.replace(
            '{n}',
            String(inspection.evals.count),
          )}
        >
          {inspection.evals.cases.length > 0 ? (
            <Chips items={inspection.evals.cases} />
          ) : null}
        </Section>
      ) : null}

      <Section title={t.plugins.details.catalog}>
        <dl className="flex flex-col gap-1.5">
          {ref ? (
            <Row label={t.plugins.details.source} value={ref} mono />
          ) : null}
          <Row label={t.plugins.details.catalog} value={entry.sourceName} />
          {catalogUrl ? (
            <Row
              label={t.plugins.details.catalogUrl}
              value={<Link href={catalogUrl} />}
            />
          ) : null}
          {meta.license ? (
            <Row label={t.plugins.details.license} value={meta.license} />
          ) : null}
          {meta.category ? (
            <Row label={t.plugins.filters.type} value={meta.category} />
          ) : null}
          {publisher ? (
            <Row
              label={t.plugins.details.publisher}
              value={
                publisher.url ? (
                  <Link href={publisher.url} label={publisher.name} />
                ) : (
                  publisher.name
                )
              }
            />
          ) : null}
          {homepage ? (
            <Row
              label={t.plugins.details.homepage}
              value={<Link href={homepage} />}
            />
          ) : null}
        </dl>
      </Section>

      {tags.length > 0 || capabilities.length > 0 ? (
        <Section title={t.plugins.details.metadata}>
          {tags.length > 0 ? (
            <Field label={t.plugins.details.tags}>
              <Chips items={tags.slice(0, 20)} />
            </Field>
          ) : null}
          {capabilities.length > 0 ? (
            <Field label={t.plugins.details.capabilities}>
              <Chips items={capabilities} mono />
            </Field>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
