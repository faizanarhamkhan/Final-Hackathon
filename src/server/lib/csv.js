import { parse as parseCsv } from 'csv-parse/sync';

export function readCsv(text) {
  return parseCsv(text, {
    columns: (header) => header.map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_')),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });
}

const escape = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => escape(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
