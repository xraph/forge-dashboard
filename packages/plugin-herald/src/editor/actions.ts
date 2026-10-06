/**
 * Where Go template actions sit in a field's source.
 *
 * An action runs from "{{" to the next "}}" that isn't inside a quoted string,
 * a raw string or a comment. The editor tints each one so an action reads as
 * code inside prose or markup, and completion offers variables and functions
 * only inside one. Nothing here touches CodeMirror, so pages and tests import
 * it without pulling the editor into the entry chunk.
 */
export interface ActionRange {
  from: number
  /** Exclusive. The end of the text when the action never closes. */
  to: number
  closed: boolean
}

/** Past a quoted string starting at `start`. Go strings can't span lines, so an unterminated one ends at the line. */
function skipQuoted(text: string, start: number, quote: string): number {
  let j = start + 1
  while (j < text.length) {
    const c = text[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === quote) return j + 1
    if (c === "\n") return j
    j++
  }
  return text.length
}

export function findActions(text: string): ActionRange[] {
  const out: ActionRange[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf("{{", i)
    if (open === -1) break
    let j = open + 2
    let closed = false
    while (j < text.length) {
      const c = text[j]
      if (c === '"' || c === "'") {
        j = skipQuoted(text, j, c)
        continue
      }
      if (c === "`") {
        const end = text.indexOf("`", j + 1)
        j = end === -1 ? text.length : end + 1
        continue
      }
      if (c === "/" && text[j + 1] === "*") {
        const end = text.indexOf("*/", j + 2)
        j = end === -1 ? text.length : end + 2
        continue
      }
      if (c === "}" && text[j + 1] === "}") {
        j += 2
        closed = true
        break
      }
      j++
    }
    out.push({ from: open, to: closed ? j : text.length, closed })
    i = closed ? j : text.length
  }
  return out
}

/** Whether `pos` is inside an action's body: after its "{{", and before its "}}" when it has one. */
export function inAction(text: string, pos: number): boolean {
  return findActions(text).some((a) => pos >= a.from + 2 && (a.closed ? pos <= a.to - 2 : pos <= a.to))
}
