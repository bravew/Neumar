export type FileOperation = 'write' | 'edit' | 'read' | 'rename' | 'delete';

export interface FileOperationInput {
  name: string;
  args: Record<string, unknown>;
}

export interface ProducedFile {
  path: string;
  operation: 'written' | 'edited' | 'renamed';
}

export interface FileOperationSummary {
  producedFiles: ProducedFile[];
  referencedPaths: string[];
  totals: Record<FileOperation, number>;
}

const EMPTY_TOTALS: Record<FileOperation, number> = {
  write: 0,
  edit: 0,
  read: 0,
  rename: 0,
  delete: 0,
};

export function summarizeFileOperations(
  operations: readonly FileOperationInput[],
): FileOperationSummary {
  const totals = { ...EMPTY_TOTALS };
  const produced = new Map<string, ProducedFile['operation']>();
  const referencedPaths = new Set<string>();

  for (const input of operations) {
    const operation = classifyOperation(input.name);
    if (!operation) continue;
    totals[operation] += 1;

    if (operation === 'rename') {
      const from = firstPath(input.args, ['from', 'old_path', 'source_path']);
      const to = firstPath(input.args, [
        'to',
        'new_path',
        'destination_path',
        'target_path',
      ]);
      if (from) {
        referencedPaths.add(from);
        produced.delete(from);
      }
      if (to) {
        referencedPaths.add(to);
        produced.set(to, 'renamed');
      }
      continue;
    }

    const path = firstPath(input.args, ['file_path', 'path', 'filePath']);
    if (!path) continue;
    referencedPaths.add(path);
    if (operation === 'delete') {
      produced.delete(path);
    } else if (operation === 'write') {
      if (!produced.has(path)) produced.set(path, 'written');
    } else if (operation === 'edit') {
      produced.set(path, 'edited');
    }
  }

  return {
    producedFiles: [...produced].map(([path, operation]) => ({
      path,
      operation,
    })),
    referencedPaths: [...referencedPaths],
    totals,
  };
}

function classifyOperation(name: string): FileOperation | null {
  const normalized = name.split('__').pop()?.toLowerCase() ?? '';
  if (
    /^(write|write_file|mediagenerateimage|media_generate_image)$/.test(
      normalized,
    )
  ) {
    return 'write';
  }
  if (/^(edit|edit_file|multiedit|notebookedit)$/.test(normalized))
    return 'edit';
  if (/^(read|read_file)$/.test(normalized)) return 'read';
  if (/^(rename|rename_file|move|move_file|mv)$/.test(normalized))
    return 'rename';
  if (/^(delete|delete_file|remove|remove_file|rm)$/.test(normalized)) {
    return 'delete';
  }
  return null;
}

function firstPath(args: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
