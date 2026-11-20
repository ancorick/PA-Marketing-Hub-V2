/**
 * RFC 4180 CSV: quoted fields with commas, quotes ("") and line breaks; CRLF or LF; UTF-8 BOM.
 * The delimiter is detected from the header line: comma, semicolon (Excel in hy/ru locales) or tab.
 */
export function parseCsv(input: string, maxRows = 20_000): { rows: string[][]; delimiter: string } {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  );

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > maxRows) throw new Error(`The file has more than ${maxRows.toLocaleString('en')} rows; split it into smaller files`);
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length > maxRows + 1) throw new Error(`The file has more than ${maxRows.toLocaleString('en')} rows; split it into smaller files`);
  return { rows, delimiter };
}
