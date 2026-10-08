/**
 * Where a server diagnostic points, in the editor's terms.
 *
 * Herald reports a 1-based line and a 1-based column counted in characters
 * (Unicode code points) on the field's own source, converting Go's byte
 * column first (template/diagnostics.go, charColumn). The editor counts UTF-16
 * units from the start of the document, so an emoji is one column to Herald
 * and two units here. Column 0 means Herald had none, which is how a parse
 * error arrives. No CodeMirror import: the page and tests use this directly.
 */
interface Line {
  start: number
  text: string
}

function lineOf(text: string, line: number): Line {
  const lines = text.split("\n")
  const index = Math.min(Math.max(line, 1), lines.length) - 1
  let start = 0
  for (let i = 0; i < index; i++) start += lines[i].length + 1
  return { start, text: lines[index] }
}

/** The document offset of a 1-based line and character column. Column 0 or 1 is the line's start; past the end clamps to it. */
export function offsetOf(text: string, line: number, column: number): number {
  const l = lineOf(text, line)
  if (column <= 1) return l.start
  let units = 0
  let chars = 1
  for (const ch of l.text) {
    if (chars === column) break
    units += ch.length
    chars++
  }
  return l.start + units
}

const TOKEN = /^[A-Za-z0-9_.$]+/

/**
 * What a diagnostic underlines: the token starting at its column, one
 * character when no token starts there, the character before the end when
 * the column is past the line, or the whole line when it has no column.
 */
export function diagnosticRange(
  text: string,
  line: number,
  column: number
): { from: number; to: number } {
  const l = lineOf(text, line)
  if (column <= 0) return { from: l.start, to: l.start + l.text.length }
  const at = offsetOf(text, line, column)
  const rest = l.text.slice(at - l.start)
  const token = TOKEN.exec(rest)
  if (token) return { from: at, to: at + token[0].length }
  const next = [...rest][0]
  if (next !== undefined) return { from: at, to: at + next.length }
  const before = [...l.text.slice(0, at - l.start)]
  const last = before[before.length - 1]
  return last === undefined
    ? { from: at, to: at }
    : { from: at - last.length, to: at }
}
