import type * as React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/shared/providers/language-provider';

import {
  parseDeclarativeArtifact,
  type DeclarativeArtifactSpec,
  type DeclarativeNode,
} from './schema';

interface DeclarativeArtifactProps {
  content: string;
}

type FormValue = string | boolean;
type FormValues = Record<string, FormValue>;

export function DeclarativeArtifact({ content }: DeclarativeArtifactProps) {
  const { t } = useLanguage();
  const [values, setValues] = useState<FormValues>({});
  const parsed = useMemo(() => {
    try {
      return { spec: parseDeclarativeArtifact(content), error: null };
    } catch (error) {
      return {
        spec: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [content]);

  const handleAction = useCallback(
    (actionId: string) => {
      window.dispatchEvent(
        new CustomEvent('neuma:declarative-artifact-action', {
          detail: {
            actionId,
            values,
            version: parsed.spec?.version,
          },
        }),
      );
    },
    [parsed.spec?.version, values],
  );

  if (!parsed.spec) {
    return (
      <div className="text-destructive bg-destructive/5 border-destructive/20 rounded border p-4 text-sm">
        <div className="font-medium">{t.common.error}</div>
        <pre className="mt-2 text-xs whitespace-pre-wrap">{parsed.error}</pre>
      </div>
    );
  }

  return (
    <div className="bg-background h-full overflow-auto p-4">
      <div className="mx-auto max-w-3xl">
        <DeclarativeNodeView
          node={parsed.spec.root}
          spec={parsed.spec}
          values={values}
          setValues={setValues}
          onAction={handleAction}
        />
      </div>
    </div>
  );
}

function DeclarativeNodeView({
  node,
  spec,
  values,
  setValues,
  onAction,
}: {
  node: DeclarativeNode;
  spec: DeclarativeArtifactSpec;
  values: FormValues;
  setValues: React.Dispatch<React.SetStateAction<FormValues>>;
  onAction: (actionId: string) => void;
}) {
  const children = node.children?.map((child, index) => (
    <DeclarativeNodeView
      key={index}
      node={child}
      spec={spec}
      values={values}
      setValues={setValues}
      onAction={onAction}
    />
  ));

  switch (node.type) {
    case 'Card':
      return (
        <section className="border-border bg-card text-card-foreground rounded-lg border p-4">
          {children}
        </section>
      );
    case 'Stack':
    case 'Form':
      return <div className="space-y-3">{children}</div>;
    case 'Heading':
      return (
        <h2 className="text-foreground text-lg font-semibold">
          {node.text}
          {children}
        </h2>
      );
    case 'Text':
      return (
        <p className="text-muted-foreground text-sm">
          {node.text}
          {children}
        </p>
      );
    case 'Code':
      return (
        <pre className="bg-muted overflow-auto rounded p-3 text-xs">
          <code>{node.text}</code>
        </pre>
      );
    case 'Link': {
      const rawHref =
        typeof node.props?.href === 'string' ? node.props.href : '#';
      return (
        <a
          href={sanitizeHref(rawHref)}
          target="_blank"
          rel="noreferrer"
          className="text-primary text-sm underline"
        >
          {node.text}
        </a>
      );
    }
    case 'List':
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(
            node.props?.items as Array<string | number | boolean> | undefined
          )?.map((item, index) => <li key={index}>{String(item)}</li>) ??
            children}
        </ul>
      );
    case 'Tabs':
      return <div className="border-border rounded border p-3">{children}</div>;
    case 'TextField':
    case 'TextArea':
    case 'Select':
    case 'Checkbox':
    case 'RadioGroup':
      return <FieldPreview node={node} values={values} setValues={setValues} />;
    case 'Button': {
      const actionId = getStringProp(node, 'action');
      const action = spec.actions?.find((item) => item.id === actionId);
      const variant =
        action?.variant === 'destructive'
          ? 'destructive'
          : action?.variant === 'secondary'
            ? 'outline'
            : 'default';
      return (
        <Button
          type="button"
          variant={variant}
          onClick={() => {
            if (actionId) onAction(actionId);
          }}
        >
          {node.text ?? action?.label}
        </Button>
      );
    }
  }
}

function FieldPreview({
  node,
  values,
  setValues,
}: {
  node: DeclarativeNode;
  values: FormValues;
  setValues: React.Dispatch<React.SetStateAction<FormValues>>;
}) {
  const label = getStringProp(node, 'label') ?? node.text ?? node.type;
  const name = getStringProp(node, 'name') ?? label;
  const value = values[name];

  const setValue = (next: FormValue) => {
    setValues((prev) => ({ ...prev, [name]: next }));
  };

  if (node.type === 'Checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => setValue(event.target.checked)}
          className="accent-primary size-4 rounded"
        />
        <span className="text-foreground font-medium">{label}</span>
      </label>
    );
  }

  if (node.type === 'Select' || node.type === 'RadioGroup') {
    const options = getStringArrayProp(node, 'options');
    return (
      <label className="block space-y-1 text-sm">
        <span className="text-foreground font-medium">{label}</span>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => setValue(event.target.value)}
          className="border-input bg-background text-foreground w-full rounded border px-3 py-2"
        >
          <option value="" />
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (node.type === 'TextArea') {
    return (
      <label className="block space-y-1 text-sm">
        <span className="text-foreground font-medium">{label}</span>
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => setValue(event.target.value)}
          className="border-input bg-background text-foreground min-h-24 w-full rounded border px-3 py-2"
        />
      </label>
    );
  }

  return (
    <label className="block space-y-1 text-sm">
      <span className="text-foreground font-medium">{label}</span>
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => setValue(event.target.value)}
        className="border-input bg-background text-foreground w-full rounded border px-3 py-2"
      />
    </label>
  );
}

function sanitizeHref(raw: string): string {
  try {
    const url = new URL(raw, 'https://localhost');
    return url.protocol === 'https:' ||
      url.protocol === 'http:' ||
      url.protocol === 'mailto:'
      ? url.href
      : '#';
  } catch {
    return '#';
  }
}

function getStringProp(node: DeclarativeNode, key: string): string | undefined {
  const value = node.props?.[key];
  return typeof value === 'string' ? value : undefined;
}

function getStringArrayProp(node: DeclarativeNode, key: string): string[] {
  const value = node.props?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
