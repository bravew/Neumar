// Single source for the blocklist entry contract. The committed
// doc/maintenance/incidents/blocklist.json documents this schema and must
// declare the same required fields, which check-blocklist.mjs enforces. Keep
// the validator and the documentation derived from these constants.

export const BLOCKLIST_VERSION = 1;

// Required on every entry. The contributor policy in
// doc/maintenance/2026-10-13-regression/03-lessons-and-contributors.md names
// evidence, affected scope, effective date, expiry, remediation and an appeal
// link; id, contributorReference and incidentRecords identify the entry and the
// confirmed records behind it.
export const REQUIRED_FIELDS = [
  'id',
  'contributorReference',
  'incidentRecords',
  'evidence',
  'affectedScope',
  'effectiveDate',
  'expiry',
  'remediation',
  'appealLink',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// kind is one of string, date, stringList. date validates the ISO form.
export const FIELD_SPECS = {
  id: {
    kind: 'string',
    description:
      'Stable record id for this entry, used by the incident records and the weekly review.',
  },
  contributorReference: {
    kind: 'string',
    description:
      'Opaque reference to the demonstrated contributor or tool configuration. Never a vendor, model family, or agent session name.',
  },
  incidentRecords: {
    kind: 'stringList',
    description:
      'Ids of the confirmed incident records behind this entry. Each must meet the evidence bar.',
  },
  evidence: {
    kind: 'stringList',
    description:
      'Links to the confirming artifacts, such as incident records and verification runs.',
  },
  affectedScope: {
    kind: 'string',
    description:
      'What is restricted and where, such as autonomous submission or merge for a named repository surface.',
  },
  effectiveDate: {
    kind: 'date',
    description: 'ISO date the restriction starts.',
  },
  expiry: {
    kind: 'date',
    description:
      'ISO date the entry is reviewed. A block is renewed only with stated evidence.',
  },
  remediation: {
    kind: 'string',
    description:
      'What must be done to clear the entry, such as repairing outstanding incidents and passing reviewed scoped contributions.',
  },
  appealLink: {
    kind: 'string',
    description:
      'Where an appeal is filed. An appeal can correct attribution, severity, or causation at any time.',
  },
};

function checkValue(kind, value) {
  if (kind === 'string') {
    return typeof value === 'string' && value.trim().length > 0;
  }
  if (kind === 'date') {
    return typeof value === 'string' && ISO_DATE.test(value);
  }
  if (kind === 'stringList') {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && item.trim().length > 0)
    );
  }
  return false;
}

// Returns { ok, errors }. errors is a list of human-readable strings.
export function validateBlocklist(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['blocklist must be a JSON object'] };
  }

  const declaredRequired = doc.schema?.entry?.required;
  if (!Array.isArray(declaredRequired)) {
    errors.push('schema.entry.required must be an array of field names');
  } else {
    const declared = [...declaredRequired].sort().join(',');
    const expected = [...REQUIRED_FIELDS].sort().join(',');
    if (declared !== expected) {
      errors.push(
        `schema.entry.required does not match the validator contract: expected ${expected}`,
      );
    }
  }

  if (!Array.isArray(doc.entries)) {
    errors.push('entries must be an array');
    return { ok: errors.length === 0, errors };
  }

  doc.entries.forEach((entry, index) => {
    const where = `entries[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) {
        errors.push(`${where} is missing required field "${field}"`);
        continue;
      }
      const spec = FIELD_SPECS[field];
      if (!checkValue(spec.kind, entry[field])) {
        errors.push(`${where}.${field} must be a non-empty ${spec.kind}`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
