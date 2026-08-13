import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Phase 6 M2 — fetch a template's FormSpec from the server-side
// `schemaToFormSpec` mapper. Server is the single source of truth so the
// frontend doesn't bundle the mapper.

export type AssetPickerKind = 'image' | 'audio' | 'video' | 'data';

interface BaseField {
  key: string;
  label: string;
  required: boolean;
  helpText?: string;
  warnings: string[];
}

export type FormField =
  | (BaseField & {
      kind: 'text';
      defaultValue?: string;
      maxLength?: number;
      pattern?: string;
    })
  | (BaseField & {
      kind: 'textarea';
      defaultValue?: string;
      maxLength?: number;
    })
  | (BaseField & { kind: 'select'; defaultValue?: string; options: string[] })
  | (BaseField & { kind: 'date'; defaultValue?: string })
  | (BaseField & {
      kind: 'number';
      defaultValue?: number;
      minimum?: number;
      maximum?: number;
      integer: boolean;
    })
  | (BaseField & { kind: 'toggle'; defaultValue?: boolean })
  | (BaseField & { kind: 'tagList'; itemType: 'string' | 'number' })
  | (BaseField & {
      kind: 'table';
      columns: FormField[];
      minItems?: number;
      maxItems?: number;
    })
  | (BaseField & { kind: 'fieldset'; fields: FormField[] })
  | (BaseField & { kind: 'assetPicker'; assetKind: AssetPickerKind });

export interface FormSpec {
  type: 'object';
  fields: FormField[];
  warnings: string[];
}

export interface UseFormSpecResult {
  formSpec: FormSpec | null;
  loading: boolean;
  error: string | null;
}

export function useFormSpec(templateId: string | null): UseFormSpecResult {
  const [formSpec, setFormSpec] = useState<FormSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) {
      setFormSpec(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/video/html-gallery/${encodeURIComponent(templateId)}/form-spec`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { formSpec: FormSpec };
        if (ac.signal.aborted) return;
        setFormSpec(json.formSpec);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [templateId]);

  return { formSpec, loading, error };
}
