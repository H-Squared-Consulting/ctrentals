import { useState, useMemo, useEffect, Fragment, type ReactNode } from 'react';
import { useLayout } from '../contexts/LayoutContext';
import ToolbarActions from './ToolbarActions';
import EmptyState from './EmptyState';

// ---- Types ----

export type DataRow = { [key: string]: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Column<R = any> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: R) => ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
  hideOnMobile?: boolean;
  /** Extra class applied to both <th> and <td>. Use for column-level tinting
   *  / grouping accents that aren't appropriate at the row level. */
  cellClassName?: string;
  /** Optional label for a group header rendered above this column. Contiguous
   *  columns sharing the same group string merge into one colspan'd cell. */
  group?: string;
}

export interface FilterOption {
  value: string;
  label: string;
  matchValues?: string[];
}

export interface Filter {
  key: string;
  label: string;
  options: FilterOption[];
  matchFn?: (row: DataRow, filterValue: string) => boolean;
}

interface PrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface OverflowAction {
  label: string;
  icon?: string;
  onClick: () => void;
}

export interface HeaderActions {
  primary?: PrimaryAction;
  secondary?: PrimaryAction;
  onSync?: (() => void) | { label: string; onClick: () => void } | Array<{ label: string; onClick: () => void }>;
  overflow?: OverflowAction[];
}

interface SortConfig {
  key: string | null;
  direction: 'asc' | 'desc';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DataTableProps<R = any> {
  columns?: Column<R>[];
  data?: R[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  onRowClick?: (row: R) => void;
  emptyMessage?: string | ReactNode;
  actions?: (row: R) => ReactNode;
  filters?: Filter[];
  defaultFilterValues?: Record<string, string>;
  defaultSort?: SortConfig | null;
  headerActions?: HeaderActions | ReactNode;
  loading?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  idKey?: string;
  resultsBarContent?: ReactNode;
  pageSize?: number;
  description?: string;
  rowClassName?: (row: R) => string;
  renderSubRow?: (row: R) => ReactNode;
}

function DataTable({
  columns = [],
  data = [],
  searchable = true,
  searchPlaceholder = 'Search...',
  searchKeys = [],
  onRowClick,
  emptyMessage = 'No data found',
  actions,
  filters = [],
  defaultFilterValues = {},
  defaultSort = null,
  headerActions,
  loading = false,
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  idKey = 'id',
  resultsBarContent,
  pageSize = 0,
  description = '',
  rowClassName,
  renderSubRow,
}: DataTableProps) {
  const { isMobile } = useLayout();
  const visibleColumns = useMemo(
    () => isMobile ? columns.filter(c => !c.hideOnMobile) : columns,
    [columns, isMobile]
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>(defaultSort || { key: null, direction: 'asc' });
  const [filterValues, setFilterValues] = useState<Record<string, string>>(defaultFilterValues);
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const activeFilterCount = Object.entries(filterValues).filter(
    ([key, value]) => value && value !== 'all' && value !== defaultFilterValues[key]
  ).length;

  // Filter and search data
  const filteredData = useMemo(() => {
    let result = [...data];

    if (searchQuery && searchKeys.length > 0) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(row => {
        const fieldValues = searchKeys.map(key => {
          const value = getNestedValue(row, key);
          return value ? String(value).toLowerCase() : '';
        });
        const combined = fieldValues.join(' ');
        return terms.every(term => combined.includes(term));
      });
    }

    Object.entries(filterValues).forEach(([filterKey, filterValue]) => {
      if (filterValue && filterValue !== 'all') {
        const filterConfig = filters.find(f => f.key === filterKey);
        const optionConfig = filterConfig?.options?.find(o => o.value === filterValue);
        const matchValues = optionConfig?.matchValues;

        result = result.filter(row => {
          if (filterConfig?.matchFn) return filterConfig.matchFn(row, filterValue);
          const rowValue = getNestedValue(row, filterKey);
          if (matchValues) return matchValues.includes(rowValue as string);
          return rowValue === filterValue;
        });
      }
    });

    return result;
  }, [data, searchQuery, searchKeys, filterValues, filters]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortConfig.key) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = getNestedValue(a, sortConfig.key!);
      const bVal = getNestedValue(b, sortConfig.key!);
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime();
      } else {
        comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });
      }
      return sortConfig.direction === 'desc' ? -comparison : comparison;
    });
  }, [filteredData, sortConfig]);

  // Paginate data
  const totalPages = pageSize > 0 ? Math.ceil(sortedData.length / pageSize) : 1;
  const paginatedData = useMemo(() => {
    if (pageSize <= 0) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterValues]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    const pageIds = paginatedData.map(row => String(row[idKey] ?? ''));
    const allSelected = pageIds.every(id => selectedIds.has(id));
    if (allSelected) {
      const newSet = new Set(selectedIds);
      pageIds.forEach(id => newSet.delete(id));
      onSelectionChange(newSet);
    } else {
      const newSet = new Set(selectedIds);
      pageIds.forEach(id => newSet.add(id));
      onSelectionChange(newSet);
    }
  };

  const handleSelectRow = (row: DataRow) => {
    if (!onSelectionChange) return;
    const id = String(row[idKey] ?? '');
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); }
    onSelectionChange(newSet);
  };

  const isAllSelected = paginatedData.length > 0 && paginatedData.every(row => selectedIds.has(String(row[idKey] ?? '')));

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    );
  }

  const primaryAction = (headerActions && typeof headerActions === 'object' && 'primary' in (headerActions as HeaderActions))
    ? (headerActions as HeaderActions).primary
    : undefined;

  return (
    <>
    <div className="card">
      {description && <div className="datatable-description">{description}</div>}

      {/* Toolbar — only render when there's actually something inside it.
       * Callers (like the Ops pages) wrap the table in their own toolbar
       * and pass searchable=false, no filters, no headerActions: in that
       * case the internal toolbar would render as an empty white strip. */}
      {(searchable || filters.length > 0 || selectable || headerActions) && (
        <div className="list-toolbar">
          <div className="list-toolbar-left">
            {selectable && paginatedData.length > 0 && (
              <label className="list-select-all">
                <input type="checkbox" checked={isAllSelected} onChange={handleSelectAll} />
                Select All
              </label>
            )}

            {searchable && (
              <div className="list-search">
                <span className="list-search-icon">🔍</span>
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="list-search-clear" onClick={() => setSearchQuery('')}>✕</button>
                )}
              </div>
            )}

            {filters.length > 0 && (
              <button className="list-filter-toggle" onClick={() => setFiltersExpanded(!filtersExpanded)}>
                <span>⚙</span>
                <span>Filters</span>
                {activeFilterCount > 0 && <span className="list-filter-badge">{activeFilterCount}</span>}
                <span className="list-filter-arrow">{filtersExpanded ? '▲' : '▼'}</span>
              </button>
            )}

            <div className="list-filters-inline">
              {filters.map(filter => (
                <select
                  key={filter.key}
                  className="list-filter"
                  value={filterValues[filter.key] || 'all'}
                  onChange={(e) => handleFilterChange(filter.key, e.target.value)}
                >
                  <option value="all">{filter.label}: All</option>
                  {filter.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ))}
            </div>
          </div>

          {headerActions && (
            <div className="list-toolbar-right">
              {(typeof headerActions === 'object' && ('primary' in (headerActions as HeaderActions) || 'secondary' in (headerActions as HeaderActions) || 'onSync' in (headerActions as HeaderActions) || 'overflow' in (headerActions as HeaderActions))) ? (
                <ToolbarActions
                  primary={(headerActions as HeaderActions).primary}
                  secondary={(headerActions as HeaderActions).secondary}
                  onSync={(headerActions as HeaderActions).onSync}
                  overflow={(headerActions as HeaderActions).overflow}
                />
              ) : (
                headerActions as ReactNode
              )}
            </div>
          )}
        </div>
      )}

      {/* Mobile: Expandable filters */}
      {filters.length > 0 && (
        <div className={`list-filters-mobile ${filtersExpanded ? 'expanded' : ''}`}>
          {filters.map(filter => (
            <select
              key={filter.key}
              className="list-filter"
              value={filterValues[filter.key] || 'all'}
              onChange={(e) => handleFilterChange(filter.key, e.target.value)}
            >
              <option value="all">{filter.label}: All</option>
              {filter.options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ))}
        </div>
      )}

      {/* Results bar — same suppression rule: don't render if the caller
       * has explicitly opted out (resultsBarContent === null). */}
      {resultsBarContent !== null && (
        <div className="results-bar">
          {resultsBarContent || (
            <>
              {sortedData.length} of {data.length} items
              {searchQuery && ` matching "${searchQuery}"`}
              {selectable && selectedIds.size > 0 && (
                <span style={{ marginLeft: '1rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                  | {selectedIds.size} selected
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Table */}
      {paginatedData.length === 0 ? (
        typeof emptyMessage === 'string' ? (
          <EmptyState icon="🔎" title={emptyMessage} />
        ) : (
          <div className="empty-state">{emptyMessage}</div>
        )
      ) : (
        <div className="mobile-table-scroll">
          <table className="data-table">
            <thead>
              {visibleColumns.some(c => c.group) && (
                <tr className="datatable-group-row">
                  {selectable && <th aria-hidden="true" />}
                  {(() => {
                    const cells: ReactNode[] = [];
                    let i = 0;
                    while (i < visibleColumns.length) {
                      const col = visibleColumns[i];
                      if (col.group) {
                        let j = i;
                        while (j < visibleColumns.length && visibleColumns[j].group === col.group) j++;
                        const span = j - i;
                        cells.push(
                          <th key={`grp-${i}`} colSpan={span} className={`datatable-group-label ${col.cellClassName || ''}`}>
                            {col.group}
                          </th>
                        );
                        i = j;
                      } else {
                        cells.push(<th key={`grp-${i}`} aria-hidden="true" />);
                        i++;
                      }
                    }
                    return cells;
                  })()}
                  {actions && <th aria-hidden="true" />}
                </tr>
              )}
              <tr>
                {selectable && (
                  <th className="table-col-checkbox">
                    <input type="checkbox" checked={isAllSelected} onChange={handleSelectAll} />
                  </th>
                )}
                {visibleColumns.map(col => (
                  <th
                    key={col.key}
                    className={`${col.sortable ? 'sortable' : ''} ${col.align ? `text-${col.align}` : 'text-left'} ${col.cellClassName || ''}`}
                    style={{ width: col.width }}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <span>{col.label}</span>
                    {col.sortable && (
                      <span className="sort-icon">
                        {sortConfig.key === col.key
                          ? sortConfig.direction === 'asc' ? ' ↑' : ' ↓'
                          : ' ↕'}
                      </span>
                    )}
                  </th>
                ))}
                {actions && <th className="table-col-actions">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((row, idx) => {
                const rowKey = String(row[idKey] ?? idx);
                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={`${rowClassName ? rowClassName(row) : ''} ${onRowClick ? 'table-row-clickable' : ''}`}
                      onClick={() => onRowClick && onRowClick(row)}
                    >
                      {selectable && (
                        <td className="text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(String(row[idKey] ?? ''))}
                            onChange={() => handleSelectRow(row)}
                          />
                        </td>
                      )}
                      {visibleColumns.map(col => (
                        <td key={col.key} className={`${col.align ? `text-${col.align}` : 'text-left'} ${col.cellClassName || ''}`}>
                          {col.render
                            ? col.render(row)
                            : (getNestedValue(row, col.key) as ReactNode) ?? '-'}
                        </td>
                      ))}
                      {actions && (
                        <td className="text-center" onClick={e => e.stopPropagation()}>
                          <div className="table-actions">{actions(row)}</div>
                        </td>
                      )}
                    </tr>
                    {renderSubRow && (
                      <tr className="table-sub-row">
                        <td colSpan={visibleColumns.length + (selectable ? 1 : 0) + (actions ? 1 : 0)} style={{ padding: 0 }}>
                          {renderSubRow(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pageSize > 0 && totalPages > 1 && (
        <div className="table-pagination">
          <button className="table-pagination-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>«</button>
          <button className="table-pagination-btn" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>‹</button>
          <span className="table-pagination-info">Page {currentPage} of {totalPages}</span>
          <button className="table-pagination-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>›</button>
          <button className="table-pagination-btn" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>»</button>
        </div>
      )}
    </div>

      {primaryAction && (
        <button className="fab" onClick={primaryAction.onClick} disabled={primaryAction.disabled} title={primaryAction.label}>+</button>
      )}
    </>
  );
}

function getNestedValue(obj: DataRow, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

interface StatusBadgeProps {
  status?: string;
  config?: Record<string, { label: string; bg: string; color: string; icon?: string }>;
  bg?: string;
  color?: string;
  children?: ReactNode;
}

export function StatusBadge({ status, config, bg, color, children }: StatusBadgeProps) {
  if (bg !== undefined || children !== undefined) {
    return (
      <span className="status-badge" style={{ background: bg || '#e5e7eb', color: color || '#6b7280' }}>
        {children}
      </span>
    );
  }
  const fallback = { label: status, bg: '#e5e7eb', color: '#6b7280' };
  const statusConfig = config?.[status || ''] || fallback;
  return (
    <span className="status-badge" style={{ background: statusConfig.bg, color: statusConfig.color }}>
      {statusConfig.label}
    </span>
  );
}

export default DataTable;
