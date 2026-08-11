/**
 * CSV serialisation for the organizer/admin report downloads.
 */

/**
 * Quote a value for CSV.
 *
 * Cells beginning with =, +, - or @ are prefixed with a single quote. Without
 * this, a crafted attendee name would execute as a formula when the exported
 * report is opened in Excel or Sheets (CSV injection).
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let str: string;
  if (value instanceof Date) str = value.toISOString();
  else if (typeof value === 'object') str = JSON.stringify(value);
  else str = String(value);

  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\n\r]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [columns.map((column) => escapeCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))).join(','));
  }
  // A UTF-8 BOM makes Excel honour the encoding for non-ASCII attendee names.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${prefix}-${stamp}.csv`;
}
