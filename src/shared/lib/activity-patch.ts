/**
 * The RFC 6902 patch engine for AG-UI activity content.
 *
 * Shared by the thread store and the shared chat-panel adapter so an activity
 * that arrives through either path follows the same rules. The server applies
 * the same operations before persisting (see ag-ui/persistence.ts); this is the
 * client half, and it validates structure rather than trusting the patch.
 */

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  from?: string;
  value?: unknown;
}

export function decodeJsonPointer(path: string): string[] | undefined {
  if (path === '') return [];
  if (!path.startsWith('/')) return undefined;
  try {
    return path
      .slice(1)
      .split('/')
      .map((part) => {
        if (/~(?![01])/.test(part)) throw new Error('invalid pointer escape');
        return part.replace(/~1/g, '/').replace(/~0/g, '~');
      });
  } catch {
    return undefined;
  }
}

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** RFC 6902 `test` equality: deep, and insensitive to object key order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        jsonEqual(left[key], right[key]),
    )
  );
}

/** A canonical array index: no sign, no leading zero, no exponent, not empty. */
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/** Apply a structurally checked RFC 6902 patch to a private JSON clone. */
export function applyActivityPatch(
  source: Record<string, unknown>,
  rawPatch: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(rawPatch)) return undefined;
  let document: unknown = jsonClone(source);
  const locate = (root: unknown, parts: string[]) => {
    let value = root;
    for (const part of parts) {
      if (Array.isArray(value)) {
        if (!ARRAY_INDEX.test(part) || Number(part) >= value.length)
          return undefined;
        value = value[Number(part)];
      } else if (
        value &&
        typeof value === 'object' &&
        Object.prototype.hasOwnProperty.call(value, part)
      ) {
        value = (value as Record<string, unknown>)[part];
      } else return undefined;
    }
    return value;
  };
  const write = (
    root: unknown,
    parts: string[],
    op: 'add' | 'remove' | 'replace',
    value?: unknown,
  ): unknown => {
    if (!parts.length) {
      if (op === 'remove') throw new Error('cannot remove document root');
      return jsonClone(value);
    }
    const parent = locate(root, parts.slice(0, -1));
    const key = parts.at(-1)!;
    if (parent && typeof parent === 'object') {
      for (const part of parts) {
        if (
          part === '__proto__' ||
          part === 'constructor' ||
          part === 'prototype'
        )
          throw new Error('unsafe JSON pointer');
      }
      if (Array.isArray(parent)) {
        const index =
          key === '-' && op === 'add'
            ? parent.length
            : ARRAY_INDEX.test(key)
              ? Number(key)
              : -1;
        if (
          index < 0 ||
          index > parent.length ||
          (op !== 'add' && index >= parent.length)
        )
          throw new Error('invalid array index');
        if (op === 'add') parent.splice(index, 0, jsonClone(value));
        else if (op === 'remove') parent.splice(index, 1);
        else parent[index] = jsonClone(value);
      } else {
        const record = parent as Record<string, unknown>;
        if (op !== 'add' && !Object.prototype.hasOwnProperty.call(record, key))
          throw new Error('path does not exist');
        if (op === 'remove') delete record[key];
        else record[key] = jsonClone(value);
      }
      return root;
    }
    throw new Error('parent path does not exist');
  };
  try {
    for (const raw of rawPatch) {
      if (!raw || typeof raw !== 'object') return undefined;
      const operation = raw as JsonPatchOperation;
      const path = decodeJsonPointer(operation.path);
      if (!path || typeof operation.op !== 'string') return undefined;
      switch (operation.op) {
        case 'add':
        case 'replace':
          if (!('value' in operation)) return undefined;
          document = write(document, path, operation.op, operation.value);
          break;
        case 'remove':
          document = write(document, path, 'remove');
          break;
        case 'copy':
        case 'move': {
          const from =
            operation.from === undefined
              ? undefined
              : decodeJsonPointer(operation.from);
          if (!from) return undefined;
          const value = locate(document, from);
          if (value === undefined) return undefined;
          if (operation.op === 'move') {
            if (
              path.length > from.length &&
              from.every((part, i) => path[i] === part)
            )
              return undefined;
            document = write(document, from, 'remove');
          }
          document = write(document, path, 'add', value);
          break;
        }
        case 'test': {
          if (
            !('value' in operation) ||
            !jsonEqual(locate(document, path), operation.value)
          )
            return undefined;
          break;
        }
        default:
          return undefined;
      }
    }
    return document && typeof document === 'object' && !Array.isArray(document)
      ? (document as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
