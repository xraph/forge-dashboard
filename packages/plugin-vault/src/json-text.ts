/**
 * Parsing JSON typed by hand, with the place it went wrong.
 *
 * `JSON.parse` says what it disliked in words that differ between engines,
 * and only some of them give a position. A person fixing a config value needs
 * the line and the column, so a small scanner walks the text first, stops at
 * the first thing that is not JSON, and reports where. When it finds nothing
 * wrong the value comes from `JSON.parse`, so numbers and strings mean exactly
 * what they mean everywhere else.
 *
 * Nothing here touches CodeMirror, so the page can import it without pulling
 * the editor into the entry chunk.
 */

export interface JsonProblem {
  message: string
  /** One-based. */
  line: number
  /** One-based. */
  column: number
}

export type JsonParse =
  | { ok: true; value: unknown }
  | { ok: false; error: JsonProblem }

class Stop extends Error {
  readonly offset: number
  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

const NUMBER = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y
const HEX4 = /^[0-9a-fA-F]{4}$/

function scan(text: string): void {
  let i = 0

  function found(): string {
    return i >= text.length ? "the end of the text" : JSON.stringify(text[i])
  }
  function stop(message: string, at = i): never {
    throw new Stop(message, at)
  }
  function space() {
    while (i < text.length && " \t\n\r".includes(text[i])) i++
  }

  function string() {
    const start = i
    i++
    for (;;) {
      if (i >= text.length) stop("This string is never closed.", start)
      const c = text[i]
      if (c === '"') {
        i++
        return
      }
      if (c < " ") {
        stop("A line break or control character cannot sit in a string. Use an escape such as \\n.")
      }
      if (c !== "\\") {
        i++
        continue
      }
      i++
      const e = text[i]
      if (e === "u") {
        if (!HEX4.test(text.slice(i + 1, i + 5))) {
          stop("A \\u escape needs four hexadecimal digits.", i + 1)
        }
        i += 5
      } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
        i++
      } else {
        stop("That is not a valid escape in a string.")
      }
    }
  }

  function number() {
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    if (m === null) stop("That is not a valid number.")
    if (!Number.isFinite(Number(m[0]))) {
      stop("That number is too large to hold. It would be saved as null.")
    }
    i += m[0].length
  }

  function value() {
    space()
    const c = text[i]
    if (c === undefined) stop("Expected a value, but the text ends here.")
    if (c === "{") return object()
    if (c === "[") return array()
    if (c === '"') return string()
    if (c === "-" || (c >= "0" && c <= "9")) return number()
    for (const word of ["true", "false", "null"]) {
      if (text.startsWith(word, i)) {
        i += word.length
        return
      }
    }
    stop(`Expected a value, found ${found()}.`)
  }

  function object() {
    i++
    space()
    if (text[i] === "}") {
      i++
      return
    }
    for (;;) {
      space()
      if (text[i] !== '"') stop(`Expected a property name in double quotes, found ${found()}.`)
      string()
      space()
      if (text[i] !== ":") stop(`Expected ":" after the property name, found ${found()}.`)
      i++
      value()
      space()
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "}") {
        i++
        return
      }
      stop(`Expected "," or "}", found ${found()}.`)
    }
  }

  function array() {
    i++
    space()
    if (text[i] === "]") {
      i++
      return
    }
    for (;;) {
      value()
      space()
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "]") {
        i++
        return
      }
      stop(`Expected "," or "]", found ${found()}.`)
    }
  }

  space()
  if (i >= text.length) stop("There is nothing here yet. Enter a JSON value, or null.", 0)
  value()
  space()
  if (i < text.length) stop(`Expected the text to end after the value, found ${found()}.`)
}

function place(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/** Parses `text` as one JSON value, or says where it stopped being JSON. */
export function parseJsonText(text: string): JsonParse {
  try {
    scan(text)
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (err) {
    if (err instanceof Stop) {
      return { ok: false, error: { message: err.message, ...place(text, err.offset) } }
    }
    // The scanner found nothing and JSON.parse still refused, or the text was
    // nested too deeply to walk. Say so without a made-up position.
    const why = err instanceof Error ? err.message : "It could not be parsed."
    return { ok: false, error: { message: why, line: 1, column: 1 } }
  }
}

/** JSON as it is shown for editing: two-space indent, `null` for nothing. */
export function prettyJson(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value, null, 2)
}

/** Whether two JSON values are the same value. Key order does not matter, array order does. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameJson(item, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((k) => Object.hasOwn(right, k) && sameJson(left[k], right[k]))
  )
}
