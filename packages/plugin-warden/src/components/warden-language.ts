import { StreamLanguage } from "@codemirror/language"
import type { StringStream } from "@codemirror/language"

/**
 * The keywords of Warden source: the 44 non-boolean spellings in the
 * `keywords` map of warden's `dsl/token.go`, which holds 46 with `true` and
 * `false`. The lexer picks them out of the identifier stream, so a word is a
 * keyword wherever it stands, and this does the same.
 */
export const wardenKeywords: ReadonlySet<string> = new Set([
  "warden",
  "config",
  "tenant",
  "app",
  "namespace",
  "import",
  "resource",
  "relation",
  "permission",
  "role",
  "policy",
  "effect",
  "allow",
  "deny",
  "actions",
  "resources",
  "subjects",
  "when",
  "negate",
  "grants",
  "name",
  "description",
  "priority",
  "active",
  "is_system",
  "is_default",
  "max_members",
  "metadata",
  "or",
  "and",
  "not",
  "in",
  "contains",
  "starts_with",
  "ends_with",
  "exists",
  "ip_in_cidr",
  "time_after",
  "time_before",
  "all_of",
  "any_of",
  "not_before",
  "not_after",
  "obligations",
])

interface State {
  /** Inside a `/* ... *\/` comment that began on an earlier line. */
  inBlock: boolean
}

/** Consumes to the end of a block comment, or to the end of the line. */
function skipBlock(stream: StringStream, state: State): "comment" {
  while (!stream.eol()) {
    if (stream.match("*/")) {
      state.inBlock = false
      return "comment"
    }
    stream.next()
  }
  state.inBlock = true
  return "comment"
}

// An identifier may hold hyphens, but a hyphen before `>` is the `->` arrow,
// as in the lexer's `readIdent`.
const IDENT = /^[A-Za-z_](?:[A-Za-z0-9_]|-(?!>))*/
const NUMBER = /^\d+(?:\.\d+)?/
// Longest first: `=~`, `==`, `!=`, `<=`, `>=`, `->` and `+=` before their
// first character alone.
const OPERATOR = /^(?:=~|==|!=|<=|>=|->|\+=|[=<>+\-&!])/
const PUNCTUATION = /^[{}()[\],:;.|#/]/

/**
 * Warden source for CodeMirror, from warden's own lexer (`dsl/lexer.go`):
 * `//` and block comments, double-quoted strings with `\` escapes that end
 * at the end of the line, unsigned integers and decimals, keywords, `true`
 * and `false`, and punctuation. There is no grammar behind it: the server
 * parses, and the plan reports what it finds as diagnostics.
 */
export const wardenLanguage = StreamLanguage.define<State>({
  name: "warden",
  startState: () => ({ inBlock: false }),
  copyState: (state) => ({ ...state }),
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
  token(stream, state) {
    if (state.inBlock) return skipBlock(stream, state)
    if (stream.eatSpace()) return null
    if (stream.match("//")) {
      stream.skipToEnd()
      return "comment"
    }
    if (stream.match("/*")) return skipBlock(stream, state)
    if (stream.eat('"')) {
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === "\\") stream.next()
        else if (ch === '"') break
      }
      return "string"
    }
    if (stream.match(NUMBER)) return "number"
    if (stream.match(IDENT)) {
      const word = stream.current()
      if (word === "true" || word === "false") return "bool"
      return wardenKeywords.has(word) ? "keyword" : "variableName"
    }
    if (stream.match(OPERATOR)) return "operator"
    if (stream.match(PUNCTUATION)) return "punctuation"
    // A character the lexer has no token for. Consume one, or the stream
    // would not advance.
    stream.next()
    return "invalid"
  },
})
