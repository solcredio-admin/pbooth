/** One CSV cell. Text a spreadsheet would run as a formula is defused with a leading quote. */
export function cell(v: string | number | null | undefined) {
  const s = v === null || v === undefined ? "" : typeof v === "number" ? String(v) : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export const csv = (rows: (string | number | null | undefined)[][]) => "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"; // BOM: Excel reads it as UTF-8
