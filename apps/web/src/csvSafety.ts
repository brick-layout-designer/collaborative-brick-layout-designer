// Spreadsheet formula defusing for CSV exports (CWE-1236): a text cell that
// starts with `=`, `+`, `-`, `@`, a tab or a carriage return is run as a
// formula by Excel, LibreOffice and Sheets, so it gets a leading `'`.
// A plain number (`5`, `-5`, `-0.5`) is left as it is, so real data stays
// byte-identical to what BlueBrick writes.

const FORMULA_START = /^[=+\-@\t\r]/;
/** An ordinary decimal number, optionally negative: not a formula. */
const PLAIN_NUMBER = /^-?(\d+(\.\d*)?|\.\d+)$/;

/** `s`, with a leading `'` when a spreadsheet would read it as a formula. */
export function defuseFormula(s: string): string {
  return FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s;
}
