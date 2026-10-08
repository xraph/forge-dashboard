import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { TriangleAlertIcon } from "@forge-go/dashboard-kit/icons"
import { NamespaceCell } from "../components/namespace-filter"
import type { ResourceTypeSummary } from "./resource-types"
import type { AckResponse } from "./roles"

/**
 * Mirrors the Go `RelationDefDTO`. The Go name carries a DTO suffix to keep it
 * apart from `resourcetype.RelationDef`; on the wire and here it is just a
 * relation definition.
 */
export interface RelationDef {
  name: string
  allowedSubjects: string[]
}

/** Mirrors the Go `PermissionDefDTO`. */
export interface PermissionDef {
  name: string
  expression: string
}

/**
 * Mirrors the Go `ResourceTypeDetail`: `ResourceTypeSummary` embedded, so the
 * JSON is flat. Both lists are always present (the server sends `[]`, never
 * null), but the page still reads them through `?? []`, because a page that
 * throws on a null list is worse than one that shows an empty one.
 */
export interface ResourceTypeDetail extends ResourceTypeSummary {
  relations: RelationDef[]
  permissions: PermissionDef[]
  createdBy?: string
  updatedBy?: string
}

/**
 * Mirrors the Go `ExpressionDiagnostic`.
 *
 * `line` and `col` are 1-based and relative to the expression text, not to
 * any form. An expression is one line nearly always, so `line` is nearly
 * always 1 and says nothing: `col` is the useful half.
 */
export interface ExpressionDiagnostic {
  permission: string
  line: number
  col: number
  message: string
}

// ---------------------------------------------------------------------------
// Expression analysis
//
// A client-side mirror of the parts of warden's expression handling that decide
// whether an expression is sound: `dsl.CompileExpr` (lexer and parser in
// warden/dsl) and `referencedRelations` (extension/contract/
// handlers_resourcetypes.go). The server refuses a bad expression on write, but
// a type written through the DSL or the REST API before that check existed can
// carry one, and nothing else says so.
//
// What a bad reference actually does at check time (dsl/eval.go): a bare
// reference is a raw tuple lookup, CheckDirectRelation, and never consults the
// type's declared relations. So an undeclared name is not "dead". It matches a
// subject holding a stray tuple with that exact relation name, and is false for
// everyone else. relations.create, the REST write and a schema apply now refuse
// a new tuple whose relation the governing type does not declare
// (resourcetype.CheckTupleDeclared), but a stray tuple can still be stored: one
// written before the declaration changed, or written straight to the store. A
// NotExpr negates that, so `not ghost` is TRUE for almost every subject. The
// warnings are written about the reference, never about the whole expression,
// because only the reference's behaviour is certain: `viewer or ghost` still
// grants through viewer, and `not ghost` grants broadly.
//
// It is a mirror and not a shared library, so it has to be checked against the
// Go rather than trusted. The rules that matter:
//
//  - A bare identifier is a direct relation lookup on THIS type, so it must be
//    a declared relation.
//  - A traversal (`parent->read`) needs only its FIRST step declared here. Every
//    later step names a relation or permission on whichever type the first hop
//    lands on, which this type's own definition cannot know. Checking both
//    hops would warn about expressions the server accepts.
//  - A permission name is not a relation. A bare name, like the first step of
//    a traversal, is looked up as a relation tuple and never evaluated as a
//    permission, so naming a sibling permission there is the same failure.
//    (A traversal's LAST step can name a permission on the hopped type, which
//    is why this is not "an expression can only reference relations".)
//  - A reference under an odd number of negations (not, !, unary -) is
//    negated; under an even number it is not. The evaluator negates once per
//    NotExpr, so `not not ghost` is false for almost everyone again.
//  - When an expression does not parse, its references are not worth checking,
//    exactly as the server skips them.
// ---------------------------------------------------------------------------

/** Every DSL keyword other than or/and/not. Each lexes as a non-identifier. */
const OTHER_KEYWORDS = new Set([
  "warden", "config", "tenant", "app", "namespace", "import", "resource",
  "relation", "permission", "role", "policy", "effect", "allow", "deny",
  "actions", "resources", "subjects", "when", "negate", "grants", "name",
  "description", "priority", "active", "is_system", "is_default",
  "max_members", "metadata", "in", "contains", "starts_with", "ends_with",
  "exists", "ip_in_cidr", "time_after", "time_before", "all_of", "any_of",
  "not_before", "not_after", "obligations", "true", "false",
])

type TokenKind =
  | "ident"
  | "or"
  | "and"
  | "not"
  | "lparen"
  | "rparen"
  | "arrow"
  | "plus"
  | "amp"
  | "bang"
  | "minus"
  | "eof"

interface Token {
  kind: TokenKind
  value: string
}

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c)
const isIdentPart = (c: string) => /[A-Za-z0-9_-]/.test(c)

class ParseFailure extends Error {}

/**
 * Tokenizes an expression the way warden's lexer does. Throws ParseFailure on
 * anything the parser would refuse whatever surrounds it: an illegal
 * character, a number, a string, a keyword that is not or/and/not, an
 * unterminated block comment. Each of those is a parse error wherever it
 * appears, so stopping at the first is the same verdict.
 */
function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    const next = src[i + 1]
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++
    } else if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++
    } else if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2)
      if (end === -1) throw new ParseFailure("unterminated block comment")
      i = end + 2
    } else if (isIdentStart(ch)) {
      const start = i
      // A hyphen followed by > starts the arrow and ends the identifier, so
      // parent->read splits while billing-admin stays whole.
      while (
        i < src.length &&
        isIdentPart(src[i]!) &&
        !(src[i] === "-" && src[i + 1] === ">")
      ) {
        i++
      }
      const lexeme = src.slice(start, i)
      if (lexeme === "or" || lexeme === "and" || lexeme === "not") {
        out.push({ kind: lexeme, value: lexeme })
      } else if (OTHER_KEYWORDS.has(lexeme)) {
        throw new ParseFailure(`unexpected keyword ${lexeme}`)
      } else {
        out.push({ kind: "ident", value: lexeme })
      }
    } else if (ch === "(") {
      out.push({ kind: "lparen", value: ch })
      i++
    } else if (ch === ")") {
      out.push({ kind: "rparen", value: ch })
      i++
    } else if (ch === "+") {
      // `+=` is a different token in the DSL, and never valid here.
      if (next === "=") throw new ParseFailure("unexpected +=")
      out.push({ kind: "plus", value: ch })
      i++
    } else if (ch === "&") {
      out.push({ kind: "amp", value: ch })
      i++
    } else if (ch === "!") {
      // `!=` is a comparison token, never valid in an expression.
      if (next === "=") throw new ParseFailure("unexpected !=")
      out.push({ kind: "bang", value: ch })
      i++
    } else if (ch === "-") {
      if (next === ">") {
        out.push({ kind: "arrow", value: "->" })
        i += 2
      } else {
        out.push({ kind: "minus", value: ch })
        i++
      }
    } else {
      throw new ParseFailure(`unexpected character ${ch}`)
    }
  }
  out.push({ kind: "eof", value: "" })
  return out
}

/**
 * Parses tokens with the DSL's precedence (or below and below not below
 * traversal) and returns the relations the expression depends on, in the same
 * shape as the Go `referencedRelations`: a bare identifier is itself, and a
 * traversal is its first step only.
 */
/** A relation an expression names, and whether an odd number of nots sit over it. */
interface Reference {
  name: string
  negated: boolean
}

function parseReferences(tokens: Token[]): Reference[] {
  let at = 0
  const cur = () => tokens[at]!
  const advance = () => void at++

  function parseOr(): Reference[] {
    let refs = parseAnd()
    while (cur().kind === "or" || cur().kind === "plus") {
      advance()
      refs = refs.concat(parseAnd())
    }
    return refs
  }
  function parseAnd(): Reference[] {
    let refs = parseNot()
    while (cur().kind === "and" || cur().kind === "amp") {
      advance()
      refs = refs.concat(parseNot())
    }
    return refs
  }
  function parseNot(): Reference[] {
    const k = cur().kind
    if (k === "not" || k === "bang" || k === "minus") {
      advance()
      // One NotExpr flips every reference under it, at any depth, so the
      // parity of the flips is what says whether a reference is negated.
      return parseNot().map((r) => ({ ...r, negated: !r.negated }))
    }
    return parsePrimary()
  }
  function parsePrimary(): Reference[] {
    const t = cur()
    if (t.kind === "lparen") {
      advance()
      const refs = parseOr()
      if (cur().kind !== "rparen") throw new ParseFailure("expected )")
      advance()
      return refs
    }
    if (t.kind === "ident") {
      advance()
      // Only the first step is this type's business. See the header comment.
      while (cur().kind === "arrow") {
        advance()
        if (cur().kind !== "ident") throw new ParseFailure("expected identifier after ->")
        advance()
      }
      return [{ name: t.value, negated: false }]
    }
    throw new ParseFailure(`expected expression, got ${t.kind}`)
  }

  const refs = parseOr()
  if (cur().kind !== "eof") throw new ParseFailure("unexpected trailing tokens")
  return refs
}

/** One relation an expression names that this type does not declare. */
export interface UndeclaredReference {
  name: string
  /** True when the name is one of this type's permissions rather than nothing. */
  isPermission: boolean
  /**
   * True when at least one occurrence sits under an odd number of negations.
   * An undeclared reference is false for almost every subject, so a negated
   * one is true for almost every subject.
   */
  negated: boolean
}

export interface ExpressionAnalysis {
  /** False when the expression is not valid in the language at all. */
  parses: boolean
  /** Each undeclared name once, in the order first met. Empty when it does not parse. */
  undeclared: UndeclaredReference[]
}

/**
 * Finds the references in an expression that its own type does not declare,
 * and whether each sits under a negation.
 *
 * Exported so the check can be tested on its own, against the cases the Go
 * `referencedRelations` documents, without rendering a page.
 */
export function analyseExpression(
  expression: string,
  relations: RelationDef[],
  permissions: PermissionDef[]
): ExpressionAnalysis {
  let refs: Reference[]
  try {
    refs = parseReferences(tokenize(expression))
  } catch (e) {
    if (e instanceof ParseFailure) return { parses: false, undeclared: [] }
    throw e
  }
  const declared = new Set(relations.map((r) => r.name))
  const permissionNames = new Set(permissions.map((p) => p.name))
  const undeclared: UndeclaredReference[] = []
  for (const { name, negated } of refs) {
    if (declared.has(name)) continue
    const already = undeclared.find((u) => u.name === name)
    // Each name once. Negated if any occurrence is: `ghost or not ghost` has
    // a broad-granting term in it whichever occurrence is met first.
    if (already) already.negated ||= negated
    else undeclared.push({ name, isPermission: permissionNames.has(name), negated })
  }
  return { parses: true, undeclared }
}

/**
 * Reads the server's expression diagnostics off a refused write.
 *
 * They ride on `error.details.diagnostics`, which the dashboard client passes
 * through untouched. Read defensively: `details` is a free-form map, and a
 * refusal that carries something else, or nothing, must fall back to the
 * ordinary error alert rather than throw.
 */
export function diagnosticsOf(
  error: { details?: Record<string, unknown> } | undefined
): ExpressionDiagnostic[] {
  const raw = error?.details?.diagnostics
  if (!Array.isArray(raw)) return []
  const out: ExpressionDiagnostic[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const d = item as Record<string, unknown>
    if (typeof d.permission !== "string" || typeof d.message !== "string") continue
    out.push({
      permission: d.permission,
      line: typeof d.line === "number" ? d.line : 1,
      col: typeof d.col === "number" ? d.col : 0,
      message: d.message,
    })
  }
  return out
}

/**
 * Where a diagnostic points, in words. `line` is relative to the expression
 * and is 1 for nearly every expression, so it is left out unless it is
 * something else: "line 1" would read as though it located something.
 */
function locationOf(d: ExpressionDiagnostic): string {
  if (d.col < 1) return ""
  return d.line > 1 ? `line ${d.line}, column ${d.col}` : `column ${d.col}`
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function WardenResourceTypeDetailPage({ params }: PluginPageProps) {
  const id = params.id as string
  const detail = useQuery<ResourceTypeDetail>("resourceTypes.detail", { id })
  const [editing, setEditing] = useState(false)

  return (
    <QueryBoundary title="Resource type" query={detail} skeletonRows={4}>
      {(rt) => {
        const relations = rt.relations ?? []
        const permissions = rt.permissions ?? []
        return (
          <section className="flex flex-col gap-6">
            <PageHeader
              title={rt.name}
              actions={
                !editing && <IconButton onClick={() => setEditing(true)} label="Edit" />
              }
            />

            <DetailLayout
              aside={
                <DescriptionList
                  items={[
                    {
                      term: "Namespace",
                      value: <NamespaceCell path={rt.namespacePath} />,
                    },
                    {
                      term: "Description",
                      value: rt.description || <NoneCell label="description" />,
                    },
                    {
                      term: "Created by",
                      value: rt.createdBy ? (
                        <span className="font-mono text-xs">{rt.createdBy}</span>
                      ) : (
                        <NoneCell label="creator" />
                      ),
                    },
                    {
                      term: "Updated by",
                      value: rt.updatedBy ? (
                        <span className="font-mono text-xs">{rt.updatedBy}</span>
                      ) : (
                        <NoneCell label="updater" />
                      ),
                    },
                    {
                      term: "Created",
                      value: <Timestamp value={rt.createdAt} label="creation time" />,
                    },
                    {
                      term: "Updated",
                      value: <Timestamp value={rt.updatedAt} label="updated at" />,
                    },
                  ]}
                />
              }
              main={
                editing ? (
                  <EditForm
                    detail={rt}
                    onDone={() => setEditing(false)}
                  />
                ) : (
                  <>
                    <RelationsTable relations={relations} />
                    <PermissionsTable relations={relations} permissions={permissions} />
                  </>
                )
              }
            />
          </section>
        )
      }}
    </QueryBoundary>
  )
}

function RelationsTable({ relations }: { relations: RelationDef[] }) {
  const columns: Column<RelationDef>[] = [
    { id: "name", header: "Relation", cell: (r) => r.name, className: "font-medium" },
    {
      id: "subjects",
      header: "Allowed subject types",
      // An empty list puts no limit on the subject type: relations.create,
      // the REST write and a schema apply all accept any subject for this
      // relation (resourcetype.SubjectAllowed). So it reads as what it
      // allows, never as a dash or a blank that looks like nothing.
      cell: (r) =>
        (r.allowedSubjects ?? []).length === 0 ? (
          <span className="text-muted-foreground">Any subject type</span>
        ) : (
          <TagList values={r.allowedSubjects} label="allowed subject types" />
        ),
    },
  ]
  return (
    <div className="flex flex-col gap-2">
      <ResourceTable<RelationDef>
        columns={columns}
        rows={relations}
        rowKey={(r) => r.name}
        caption={`${relations.length} ${relations.length === 1 ? "relation" : "relations"}`}
        emptyMessage="This type declares no relations."
      />
      {/* relations.create, the REST write and a schema apply refuse a new
          tuple the governing resource type does not declare
          (resourcetype.CheckTupleDeclared). Nothing re-checks a stored one,
          and the evaluator resolves a name by raw tuple lookup (dsl/eval.go),
          so a tuple stored before the declaration changed, or written
          straight to the store, still counts as written. */}
      <p className="text-xs text-muted-foreground">
        The dashboard, the REST API and a schema apply refuse a new tuple these
        declarations do not allow. They govern tuples of this type in its
        namespace and below, unless a namespace closer to the tuple declares a
        type of the same name. A check still matches every stored tuple as
        written, including one stored before a declaration changed.
      </p>
    </div>
  )
}

function PermissionsTable({
  relations,
  permissions,
}: {
  relations: RelationDef[]
  permissions: PermissionDef[]
}) {
  const columns: Column<PermissionDef>[] = [
    { id: "name", header: "Permission", cell: (p) => p.name, className: "font-medium" },
    {
      id: "expression",
      header: "Expression",
      cell: (p) => (
        <ExpressionCell
          expression={p.expression}
          relations={relations}
          permissions={permissions}
        />
      ),
    },
  ]
  return (
    <ResourceTable<PermissionDef>
      columns={columns}
      rows={permissions}
      rowKey={(p) => p.name}
      caption={`${permissions.length} ${permissions.length === 1 ? "permission" : "permissions"}`}
      emptyMessage="This type declares no permissions."
    />
  )
}

/**
 * An expression, in monospace because it is a raw value, and whatever is
 * wrong with it. The server refuses these on write, but a type written before
 * that check existed can carry one, and nothing else on the page would say so.
 *
 * An expression that does not parse is refused at check time and never
 * matches, so that warning is about the whole expression. An undeclared
 * reference is different: the evaluator still looks it up as a raw tuple, so
 * only the reference's own behaviour is certain and the warning is about it.
 */
function ExpressionCell({
  expression,
  relations,
  permissions,
}: {
  expression: string
  relations: RelationDef[]
  permissions: PermissionDef[]
}) {
  const analysis = analyseExpression(expression, relations, permissions)
  return (
    <div className="flex flex-col gap-1">
      {expression.trim() === "" ? (
        <NoneCell label="expression" />
      ) : (
        <span className="font-mono text-xs">{expression}</span>
      )}
      {!analysis.parses && (
        <Warning>This expression does not parse, so it can never match.</Warning>
      )}
      {analysis.undeclared.map((u) => (
        <div key={u.name} className="flex flex-col gap-1">
          <Warning>{undeclaredWarning(u)}</Warning>
          {u.negated && <Warning>{negatedWarning(u.name)}</Warning>}
        </div>
      ))}
    </div>
  )
}

/**
 * Written about the reference, and true for every expression it can sit in.
 * The evaluator looks a bare reference up as a raw tuple, so an undeclared
 * name matches a subject holding a stray tuple of that name and nobody else.
 * A permission name is looked up the same way, as a relation tuple.
 */
function undeclaredWarning(u: UndeclaredReference): string {
  const effect = `It only takes effect through a stray ${u.name} tuple, so for almost every subject it is false.`
  return u.isPermission
    ? `${u.name} is a permission on this type, not a relation. A bare name, like the first step of a traversal, is looked up as a relation, not evaluated as a permission. ${effect}`
    : `${u.name} is not declared on this type, so it is probably a typo. ${effect}`
}

/** Under a negation the false becomes true, which widens the grant. */
function negatedWarning(name: string): string {
  return `Because ${name} is negated here, that part of the expression is true for almost every subject, which can grant this permission far more widely than intended.`
}

function Warning({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-1 text-xs text-destructive">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// ---------------------------------------------------------------------------
// The edit form
// ---------------------------------------------------------------------------

interface RelationRow {
  key: number
  name: string
  subjects: string
}

interface PermissionRow {
  key: number
  name: string
  expression: string
}

/** Row identity for React. Module-level: a key only has to be unique. */
let rowCounter = 0
const nextKey = () => ++rowCounter

const splitSubjects = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")

const blankRelation = (r: RelationRow) => r.name.trim() === "" && r.subjects.trim() === ""
const blankPermission = (p: PermissionRow) =>
  p.name.trim() === "" && p.expression.trim() === ""

/** A row's fields as they go on the wire: trimmed, subjects as a list. */
function relationsOf(rows: RelationRow[]): RelationDef[] {
  return rows
    .filter((r) => !blankRelation(r))
    .map((r) => ({ name: r.name.trim(), allowedSubjects: splitSubjects(r.subjects) }))
}
function permissionsOf(rows: PermissionRow[]): PermissionDef[] {
  return rows
    .filter((p) => !blankPermission(p))
    .map((p) => ({ name: p.name.trim(), expression: p.expression.trim() }))
}

/** The server's lists under the same normalisation as the form's. */
const normaliseRelations = (defs: RelationDef[]): RelationDef[] =>
  defs.map((d) => ({
    name: d.name.trim(),
    allowedSubjects: (d.allowedSubjects ?? []).map((s) => s.trim()),
  }))
const normalisePermissions = (defs: PermissionDef[]): PermissionDef[] =>
  defs.map((d) => ({ name: d.name.trim(), expression: d.expression.trim() }))

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function EditForm({
  detail,
  onDone,
}: {
  detail: ResourceTypeDetail
  onDone: () => void
}) {
  const update = useCommand<AckResponse>("resourceTypes.update")
  const [description, setDescription] = useState(detail.description ?? "")
  const [relationRows, setRelationRows] = useState<RelationRow[]>(() =>
    (detail.relations ?? []).map((r) => ({
      key: nextKey(),
      name: r.name,
      subjects: (r.allowedSubjects ?? []).join(", "),
    }))
  )
  const [permissionRows, setPermissionRows] = useState<PermissionRow[]>(() =>
    (detail.permissions ?? []).map((p) => ({
      key: nextKey(),
      name: p.name,
      expression: p.expression,
    }))
  )
  // What was submitted, by row. A diagnostic names a permission by the name
  // it was sent under, so anchoring it to a row has to use that name and not
  // whatever the row says now: the operator may have edited it since.
  const [attempt, setAttempt] = useState<Record<number, PermissionDef>>({})

  const relations = relationsOf(relationRows)
  const permissions = permissionsOf(permissionRows)

  // Only what the operator changed goes out. The server reads an absent field
  // as "leave it alone" and a present empty list as "remove them all", so an
  // untouched list sent as [] would wipe it. A change that leaves a list
  // equal to what it was is not a change either.
  const changed: Record<string, unknown> = {}
  if (description.trim() !== (detail.description ?? "").trim()) {
    changed.description = description.trim()
  }
  if (!same(relations, normaliseRelations(detail.relations ?? []))) {
    changed.relations = relations
  }
  if (!same(permissions, normalisePermissions(detail.permissions ?? []))) {
    changed.permissions = permissions
  }
  const dirty = Object.keys(changed).length > 0

  // A row with something in it and no name cannot be saved, and the server
  // would say so in a sentence with nothing to point at. Say it here.
  const unnamed =
    relationRows.some((r) => !blankRelation(r) && r.name.trim() === "") ||
    permissionRows.some((p) => !blankPermission(p) && p.name.trim() === "")

  async function submit() {
    if (!dirty || unnamed) return
    const submitted: Record<number, PermissionDef> = {}
    for (const p of permissionRows) {
      if (!blankPermission(p)) {
        submitted[p.key] = { name: p.name.trim(), expression: p.expression.trim() }
      }
    }
    setAttempt(submitted)
    const result = await update.execute({ id: detail.id, ...changed })
    // execute resolves undefined only when the client throws, so this is the
    // success check. A refused update, an expression diagnostic above all,
    // must leave the form open with what the operator typed.
    if (result === undefined) return
    onDone()
  }

  const diagnostics = diagnosticsOf(update.error)
  const submittedNames = new Set(Object.values(attempt).map((p) => p.name))
  // A diagnostic can name a permission that has no row here: the operator
  // renamed or removed it since the attempt. Dropping it would drop a real
  // refusal, so it is listed apart instead.
  const orphans = diagnostics.filter((d) => !submittedNames.has(d.permission))

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">
        The name and namespace cannot change, because tuples name a type by its
        name. Only what you change is saved. A list you leave alone stays as it
        is, and removing every row of one clears it.
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="resource-type-edit-description" className="text-sm font-medium">
          Description
        </label>
        <Input
          id="resource-type-edit-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Relations</legend>
        <p className="text-xs text-muted-foreground">
          Each relation lists the subject types it allows, separated by commas.
          A userset is written group#member. Leave the list empty to allow any
          subject type.
        </p>
        {relationRows.map((row, i) => (
          <div key={row.key} role="group" aria-label={`Relation ${i + 1}`} className="flex gap-2">
            <Input
              aria-label={`Relation ${i + 1} name`}
              className="w-40 font-mono text-xs"
              placeholder="viewer"
              value={row.name}
              onChange={(e) =>
                setRelationRows((rows) =>
                  rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r))
                )
              }
            />
            <Input
              aria-label={`Relation ${i + 1} subject types`}
              className="flex-1 font-mono text-xs"
              // An empty list allows any subject type, so a blank field says
              // that rather than showing an example list it does not hold.
              placeholder="Any subject type"
              value={row.subjects}
              onChange={(e) =>
                setRelationRows((rows) =>
                  rows.map((r) => (r.key === row.key ? { ...r, subjects: e.target.value } : r))
                )
              }
            />
            <IconButton variant="ghost" onClick={() => setRelationRows((rows) => rows.filter((r) => r.key !== row.key))} label={`Remove relation ${i + 1}`} />
          </div>
        ))}
        <div>
          <IconButton variant="outline" onClick={() =>
              setRelationRows((rows) => [...rows, { key: nextKey(), name: "", subjects: "" }])
            } label="Add relation" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Permissions</legend>
        <p className="text-xs text-muted-foreground">
          An expression combines relations with or, and, not, and parentheses,
          and follows a relation onto another type with parent-&gt;read.
        </p>
        {permissionRows.map((row, i) => {
          const sent = attempt[row.key]
          const rowDiagnostics = sent
            ? diagnostics.filter((d) => d.permission === sent.name)
            : []
          const describedBy = rowDiagnostics.length > 0 ? `permission-${row.key}-problems` : undefined
          return (
            <div
              key={row.key}
              role="group"
              aria-label={`Permission ${i + 1}`}
              className="flex flex-col gap-1.5"
            >
              <div className="flex gap-2">
                <Input
                  aria-label={`Permission ${i + 1} name`}
                  className="w-40 font-mono text-xs"
                  placeholder="read"
                  value={row.name}
                  onChange={(e) =>
                    setPermissionRows((rows) =>
                      rows.map((p) => (p.key === row.key ? { ...p, name: e.target.value } : p))
                    )
                  }
                />
                <Input
                  aria-label={`Permission ${i + 1} expression`}
                  aria-invalid={rowDiagnostics.length > 0 || undefined}
                  aria-describedby={describedBy}
                  className="flex-1 font-mono text-xs"
                  placeholder="viewer or editor"
                  value={row.expression}
                  onChange={(e) =>
                    setPermissionRows((rows) =>
                      rows.map((p) =>
                        p.key === row.key ? { ...p, expression: e.target.value } : p
                      )
                    )
                  }
                />
                <IconButton variant="ghost" onClick={() =>
                    setPermissionRows((rows) => rows.filter((p) => p.key !== row.key))
                  } label={`Remove permission ${i + 1}`} />
              </div>
              {/* The diagnostic sits against the expression that failed, not
                  in a banner: the whole value of having it is knowing which
                  expression, and where in it. */}
              {rowDiagnostics.length > 0 && (
                <div id={describedBy} className="flex flex-col gap-1 text-xs text-destructive">
                  {rowDiagnostics.map((d, n) => {
                    const where = locationOf(d)
                    // The pointer is only true while the text still is what
                    // was sent, and only for a one-line expression.
                    const pointer =
                      sent && d.line === 1 && d.col >= 1 && row.expression.trim() === sent.expression
                    return (
                      <div key={n} className="flex flex-col gap-0.5">
                        <p>{where ? `At ${where}: ${d.message}` : d.message}</p>
                        {pointer && (
                          <pre aria-hidden className="font-mono">
                            {`${sent.expression}\n${" ".repeat(d.col - 1)}^`}
                          </pre>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        <div>
          <IconButton variant="outline" onClick={() =>
              setPermissionRows((rows) => [
                ...rows,
                { key: nextKey(), name: "", expression: "" },
              ])
            } label="Add permission" />
        </div>
      </fieldset>

      {orphans.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-destructive">
          {orphans.map((d, n) => {
            const where = locationOf(d)
            return (
              <li key={n}>
                {`${d.permission}${where ? `, ${where}` : ""}: ${d.message}`}
              </li>
            )
          })}
        </ul>
      )}

      {unnamed && (
        <p className="text-sm text-muted-foreground">
          Every relation and permission needs a name.
        </p>
      )}

      {/* With diagnostics the message is already on the rows, so this says
          only that the save did not happen. Repeating the server's sentence
          here would say each problem twice. Any other refusal has no row to
          sit on and shows in full. */}
      {diagnostics.length > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {`Not saved. The server refused ${
            diagnostics.length === 1 ? "an expression" : `${diagnostics.length} expressions`
          }. Each problem is marked where it is.`}
        </p>
      ) : (
        <CommandAlert error={update.error} title="Could not save the resource type" />
      )}

      <div className="flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={update.loading || !dirty || unnamed}
        >
          {update.loading ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={update.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
