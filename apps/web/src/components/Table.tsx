import { ReactNode } from 'react';

interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
}

interface TableProps<T> {
  columns?: Column<T>[];
  data?: T[];
  children?: ReactNode;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  isLoading?: boolean;
  className?: string;
}

export function Table<T extends Record<string, any>>({
  columns = [],
  data = [],
  children,
  onRowClick,
  emptyMessage = 'No data available',
  isLoading = false,
  className = '',
}: TableProps<T>) {
  if (children) {
    return (
      <div className={`overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg ${className}`}>
        <table className="min-w-full divide-y divide-gray-300">
          {children}
        </table>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
        <div className="grid gap-3 bg-white p-3 md:hidden">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="h-4 w-2/3 rounded bg-gray-200 animate-pulse" />
              <div className="mt-3 h-3 w-full rounded bg-gray-100 animate-pulse" />
              <div className="mt-2 h-3 w-1/2 rounded bg-gray-100 animate-pulse" />
            </div>
          ))}
        </div>
        <table className="hidden min-w-full divide-y divide-gray-300 md:table">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                  style={{ width: column.width }}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {[...Array(5)].map((_, i) => (
              <tr key={i}>
                {columns.map((column) => (
                  <td key={String(column.key)} className="whitespace-nowrap px-3 py-4">
                    <div className="h-4 bg-gray-200 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  
  if (data.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }
  
  return (
    <div className={`overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg ${className}`}>
      <div className="grid gap-3 bg-white p-3 md:hidden">
        {data.map((row, rowIndex) => (
          <div
            key={rowIndex}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={() => onRowClick?.(row)}
            onKeyDown={(event) => {
              if (!onRowClick) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onRowClick(row);
              }
            }}
            className={`grid min-h-12 w-full gap-3 rounded-lg border border-gray-200 p-3 text-left ${onRowClick ? 'cursor-pointer hover:border-blue-200 hover:bg-blue-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500' : 'cursor-default'}`}
          >
            {columns.map((column, columnIndex) => (
              <div key={String(column.key)} className={columnIndex === 0 ? 'grid gap-1' : 'grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2'}>
                {columnIndex > 0 && <span className="pf-meta truncate">{column.header}</span>}
                <div className={columnIndex === 0 ? 'pf-row-title min-w-0' : 'min-w-0 text-sm text-gray-900'}>
                  {column.render ? column.render(row) : String(row[column.key as keyof T] ?? '')}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <table className="hidden min-w-full divide-y divide-gray-300 md:table">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                scope="col"
                className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                style={{ width: column.width }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {data.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? 'hover:bg-gray-50 cursor-pointer' : ''}
            >
              {columns.map((column) => (
                <td
                  key={String(column.key)}
                  className="whitespace-nowrap px-3 py-4 text-sm text-gray-900"
                >
                  {column.render ? column.render(row) : String(row[column.key as keyof T] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
