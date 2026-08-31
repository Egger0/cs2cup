export type CsvValue = string | number | boolean | null | undefined

function cell(value: CsvValue) {
  const text = value == null ? '' : String(value)
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function encodeCsv(rows: CsvValue[][]) {
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
