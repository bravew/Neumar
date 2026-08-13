import type { TemplateMetadata } from './gallery-schema';

// RFC-07 provenance audit, encoded as a lint helper rather than a review-time
// checklist. Runs on any template before it ships through the gallery
// (Phase 7 governance).
//
// See dev-doc/html-video/06-05/03-template-gallery-and-provenance.md and
// 06-05/07-governance-tests-rollout.md.

export interface ProvenanceLintIssue {
  code:
    | 'derived-template-missing-via-skill'
    | 'studio-name-in-id'
    | 'missing-transformation'
    | 'unsupported-spdx';
  message: string;
  severity: 'error' | 'warning';
}

export interface ProvenanceLintResult {
  ok: boolean;
  issues: ProvenanceLintIssue[];
}

// Known studio/designer name fragments that should never appear in an id
// per RFC-07 § naming rule. Matched case-insensitively as substrings.
const RESERVED_STUDIO_NAME_FRAGMENTS = [
  'pentagram',
  'takram',
  'ideo',
  'frog',
  'rga',
  'wieden',
  'sagmeister',
  'massimo-vignelli',
  'huashu',
];

// Minimal allow-list of SPDX ids the gallery actively understands at selection
// time. We don't try to ship an SPDX validator — drift in this list is fine,
// new ids surface as a warning, not a hard block.
const KNOWN_SPDX = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'Unlicense',
  'WTFPL',
  'Proprietary',
]);

export function lintTemplateProvenance(
  meta: TemplateMetadata,
): ProvenanceLintResult {
  const issues: ProvenanceLintIssue[] = [];

  const originKind = meta.provenance?.origin.kind;
  // 'unknown' means the author cannot identify the lineage; that is precisely
  // the case where via_skill cannot be filled in, so don't treat it as derived.
  const isDerived =
    originKind !== undefined &&
    originKind !== 'in-house' &&
    originKind !== 'none' &&
    originKind !== 'unknown';

  if (isDerived && !meta.provenance?.via_skill) {
    issues.push({
      code: 'derived-template-missing-via-skill',
      severity: 'error',
      message:
        `Template "${meta.id}" has provenance.origin.kind="${originKind}" ` +
        `but no provenance.via_skill block (RFC-07 § three-layer provenance).`,
    });
  }

  if (meta.provenance && !meta.provenance.transformation.trim()) {
    issues.push({
      code: 'missing-transformation',
      severity: 'error',
      message: `Template "${meta.id}" provenance.transformation is empty.`,
    });
  }

  const idLower = meta.id.toLowerCase();
  for (const fragment of RESERVED_STUDIO_NAME_FRAGMENTS) {
    if (idLower.includes(fragment)) {
      issues.push({
        code: 'studio-name-in-id',
        severity: 'error',
        message:
          `Template id "${meta.id}" contains a reserved studio/designer ` +
          `fragment "${fragment}" (RFC-07 § naming rule). Use a neutral ` +
          `descriptor name.`,
      });
      break;
    }
  }

  // Note: a dedicated "commercial use requires SPDX" check is unnecessary
  // because TemplateLicenseSchema makes spdx required (z.string().min(1)).
  // Any meta that reached this lint has already been schema-validated.
  if (!KNOWN_SPDX.has(meta.license.spdx)) {
    issues.push({
      code: 'unsupported-spdx',
      severity: 'warning',
      message:
        `Template "${meta.id}" SPDX "${meta.license.spdx}" is not in the ` +
        `gallery's known-SPDX list; selection filtering may misclassify it.`,
    });
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
  };
}
