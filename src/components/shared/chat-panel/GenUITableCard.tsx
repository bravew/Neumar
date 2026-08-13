import { Table2 } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import type {
  GenUITableCard as GenUITableCardEnvelope,
  GenUITableColumn,
  GenUITableRow,
} from '@/shared/types/gen-ui';

export function GenUITableCard({
  card,
  className,
}: {
  card: GenUITableCardEnvelope;
  className?: string;
}) {
  const { caption, columns, rows, title } = card.props;
  return (
    <section className={cn(cardShell(), className)}>
      {title && (
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <Table2 className="text-primary size-4 shrink-0" />
          <div className="text-foreground min-w-0 truncate text-sm font-medium">
            {title}
          </div>
        </div>
      )}
      <div className="border-border/60 overflow-x-auto rounded-md border">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((column, columnIndex) => (
                <th
                  key={columnKey(column, columnIndex)}
                  className="border-border/60 border-b px-2 py-1.5 text-left font-medium"
                >
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowKey(row, rowIndex)}
                className="odd:bg-background even:bg-muted/20"
              >
                {columns.map((column, columnIndex) => (
                  <td
                    key={columnKey(column, columnIndex)}
                    className="border-border/40 border-t px-2 py-1.5 align-top"
                  >
                    {cellValue(row, column, columnIndex)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && (
        <p className="text-muted-foreground mt-2 text-xs">{caption}</p>
      )}
    </section>
  );
}

function cardShell(): string {
  return 'border-border/60 bg-background my-2 rounded-lg border p-3';
}

function columnKey(column: GenUITableColumn, index: number): string {
  return typeof column === 'string' ? column : column.key || String(index);
}

function columnLabel(column: GenUITableColumn): string {
  return typeof column === 'string' ? column : (column.label ?? column.key);
}

function rowKey(row: GenUITableRow, index: number): string {
  if (Array.isArray(row)) return `${index}:${JSON.stringify(row).slice(0, 80)}`;
  const id = row.id ?? row.key ?? row.name;
  return typeof id === 'string' || typeof id === 'number'
    ? String(id)
    : `${index}:${JSON.stringify(row).slice(0, 80)}`;
}

function cellValue(
  row: GenUITableRow,
  column: GenUITableColumn,
  columnIndex: number,
): string {
  const key = columnKey(column, columnIndex);
  const value = Array.isArray(row) ? row[columnIndex] : row[key];
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
