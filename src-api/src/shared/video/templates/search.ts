// Phase 3 M2 — template search + inspect implementations.
//
// Filter the gallery loader's results by category, tags, engine, search
// substring, and license at *selection time* (RFC-07 § license drift).
// Templates that fail the gate are returned in `filteredOut` with a clear
// reason — never silently dropped.

import { type FormSpec, schemaToFormSpec } from './form-mapper';
import type { GalleryTemplate } from './gallery-loader';
import type { TemplateMetadata } from './gallery-schema';

export interface TemplateSearchFilters {
  category?: string;
  tags?: string[];
  engine?: string;
  /** Simple case-insensitive substring across name + description + tags. */
  search?: string;
  requireCommercialUse?: boolean;
  requireRedistributable?: boolean;
}

export interface TemplateSearchHit {
  id: string;
  name: string;
  description?: string;
  category: string;
  tags: string[];
  engine: string;
  license: TemplateMetadata['license'];
  /** Why this template was included given the filters. */
  scoreReason: string;
}

export interface TemplateFilteredOut {
  id: string;
  reason: string;
}

export interface TemplateSearchResult {
  templates: TemplateSearchHit[];
  filteredOut: TemplateFilteredOut[];
}

export function searchTemplates(
  templates: GalleryTemplate[],
  filters: TemplateSearchFilters = {},
): TemplateSearchResult {
  const hits: TemplateSearchHit[] = [];
  const filteredOut: TemplateFilteredOut[] = [];

  for (const t of templates) {
    const m = t.metadata;
    const reasons: string[] = [];

    if (filters.category && m.category !== filters.category) {
      filteredOut.push({
        id: t.id,
        reason: `category "${m.category}" does not match "${filters.category}"`,
      });
      continue;
    }

    if (filters.engine && m.engine !== filters.engine) {
      filteredOut.push({
        id: t.id,
        reason: `engine "${m.engine}" does not match "${filters.engine}"`,
      });
      continue;
    }

    if (filters.tags && filters.tags.length > 0) {
      const tagSet = new Set(m.tags ?? []);
      const missing = filters.tags.filter((tag) => !tagSet.has(tag));
      if (missing.length > 0) {
        filteredOut.push({
          id: t.id,
          reason: `missing required tag(s): ${missing.join(', ')}`,
        });
        continue;
      }
      reasons.push(`tags include ${filters.tags.join(', ')}`);
    }

    if (filters.search) {
      const needle = filters.search.toLowerCase();
      const haystack = [m.name ?? '', m.description ?? '', ...(m.tags ?? [])]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) {
        filteredOut.push({
          id: t.id,
          reason: `search "${filters.search}" not found in name, description, or tags`,
        });
        continue;
      }
      reasons.push(`matches "${filters.search}"`);
    }

    if (filters.requireCommercialUse && !m.license.commercial_use) {
      filteredOut.push({
        id: t.id,
        reason: `license "${m.license.spdx}" does not permit commercial use`,
      });
      continue;
    }
    if (filters.requireRedistributable && !m.license.redistribution_allowed) {
      filteredOut.push({
        id: t.id,
        reason: `license "${m.license.spdx}" does not permit redistribution`,
      });
      continue;
    }

    if (reasons.length === 0) {
      reasons.push(`all filters passed (license: ${m.license.spdx})`);
    }

    hits.push({
      id: t.id,
      name: m.name,
      description: m.description,
      category: m.category,
      tags: m.tags ?? [],
      engine: m.engine,
      license: m.license,
      scoreReason: reasons.join('; '),
    });
  }

  return { templates: hits, filteredOut };
}

export type TemplateProvenanceStatus =
  | 'in-house'
  | 'derived-verified'
  | 'derived-unverified';

export interface TemplateInspectionResult {
  metadata: TemplateMetadata;
  formSpec: FormSpec;
  provenanceStatus: TemplateProvenanceStatus;
  examples: Array<Record<string, unknown>>;
}

export function inspectTemplate(
  template: GalleryTemplate,
): TemplateInspectionResult {
  const m = template.metadata;
  const formSpec = schemaToFormSpec(m.inputs.schema);
  const provenanceStatus = classifyProvenance(m);
  const examples = Array.isArray(m.inputs.examples) ? m.inputs.examples : [];
  return { metadata: m, formSpec, provenanceStatus, examples };
}

function classifyProvenance(m: TemplateMetadata): TemplateProvenanceStatus {
  if (!m.provenance) return 'derived-unverified';
  const originKind = m.provenance.origin.kind;
  if (originKind === 'in-house' || originKind === 'none') return 'in-house';
  if (m.provenance.via_skill) return 'derived-verified';
  return 'derived-unverified';
}
