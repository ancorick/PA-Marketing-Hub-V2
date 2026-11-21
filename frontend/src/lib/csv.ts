export type CsvValue = string | number | null | undefined;

/** One CSV field (RFC 4180): quoted when it holds a delimiter, a quote or a line break. */
export function csvCell(value: CsvValue): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Text starting with = + - @ would run as a formula in a spreadsheet (CSV injection); numbers stay numbers.
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV file with CRLF line ends and a UTF-8 byte order mark, so Excel reads Armenian and Russian (ANL-12). */
export function csvFile(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
