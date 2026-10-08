# Dispatch Slice 4c: lossless payload inspection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve stored JSON text across the browser boundary and display it through a lazy read-only editor.

**Architecture:** Add a backward-compatible jsonText field alongside the existing raw JSON value. The viewer consumes jsonText verbatim, labels opaque binary/gob values, and qualifies legacy responses without original text.

**Tech stack:** Go encoding/json, React, CodeMirror 6, TypeScript, Vitest.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Constraints and interfaces

- Primary main checkouts only. Preserve concurrent changes, including Dispatch go.mod/go.sum upgrades.
- Native implementation, one fresh final review. Continue the approved migration without a new approval gate.
- Task 1 runs in /Users/rexraphael/Work/xraph/forgery/dispatch. Task 2 runs in /Users/rexraphael/Work/xraph/forge-dashboard. Keep the single ledger beside this plan, with both commit ranges recorded.
- No hidden numeric rounding or decoding gob as JSON. Do not pretty-print by parsing and reserializing.
- CodeMirror imports are isolated to src/json-view.tsx and loaded through React.lazy.
- Use the shared kit tokens and compact max-height viewer. Give its editor an accessible label and read-only state.
- Backend checks: make f, make l, Go contract tests and build. Frontend equivalents: package format, lint, typecheck and tests. Commit exact owned files and push verified commits.
- Apply rex-voice and embedded humanizer to shipped prose.
- Bundle measurements and real browser verification remain gates in the host integration slice.

## Review focus

- Large integers, trailing decimal zeros, scalars and JSON whitespace must survive browser parsing.
- Mutating source byte slices after projection must not corrupt the returned text.
- Opaque payloads must never acquire text fields.
- A legacy response must not silently display reserialized approximate numbers.
- Editor input must stay read-only and release its view on unmount.

## Task 1: Preserve raw JSON at the wire boundary

**Files:** Dispatch extension/contract/wire.go, extension/contract/foundation_test.go, new extension/contract/payload_text_test.go.
**Interfaces:** projectPayload returns existing kind/json/bytes plus jsonText only for JSON. Task 2 consumes that string.

- [ ] Add extension/contract/payload_text_test.go:

```go
package contract

import (
 "encoding/json"
 "testing"
)

func TestPayloadTextPreservesJSONLexemes(t *testing.T) {
 source := []byte("{\n\"id\":9007199254740993,\"price\":1.2300,\"text\":\"<tag>\"\n}")
 want := string(source)
 projected := projectPayload(source, false)
 source[0] = '['
 encoded, err := json.Marshal(projected)
 if err != nil { t.Fatal(err) }
 var browser map[string]any
 if err := json.Unmarshal(encoded, &browser); err != nil { t.Fatal(err) }
 if browser["jsonText"] != want { t.Fatalf("raw JSON text = %q, want %q", browser["jsonText"], want) }
 for _, raw := range []string{"null","true","123","\"text\"","[]","{}"} {
  encoded, err = json.Marshal(projectPayload([]byte(raw), true))
  if err != nil { t.Fatal(err) }
  if err := json.Unmarshal(encoded, &browser); err != nil { t.Fatal(err) }
  if browser["jsonText"] != raw { t.Fatalf("scalar %q = %#v", raw, browser) }
 }
 for _, checkpoint := range []bool{false,true} {
  encoded, err = json.Marshal(projectPayload([]byte{0,255},checkpoint))
  if err != nil { t.Fatal(err) }
  var opaque map[string]any
  if err := json.Unmarshal(encoded,&opaque); err != nil { t.Fatal(err) }
  if _, exposed := opaque["jsonText"]; exposed { t.Fatalf("opaque text leaked: %s",encoded) }
 }
}
```

- [ ] Run `go test ./extension/contract -run TestPayloadTextPreservesJSONLexemes -count=1`. Expected FAIL: jsonText is absent.
- [ ] Change Payload and the valid-JSON branch:

```go
// Payload exposes JSON with its original text and opaque content only as a size.
type Payload struct {
 Kind string `json:"kind"`
 JSON json.RawMessage `json:"json,omitempty"`
 JSONText string `json:"jsonText,omitempty"`
 Bytes *int `json:"bytes,omitempty"`
}
// In projectPayload's json.Valid branch:
return Payload{Kind: "json", JSON: bytes.Clone(data), JSONText: string(data)}
```

- [ ] Update the existing full-envelope assertion in TestWirePayloadsPreserveJSONAndDistinguishGob to expect this exact JSON:
```json
{"kind":"json","json":{"id":9007199254740993},"jsonText":"{\"id\":9007199254740993}"}
```

- [ ] Run make f, make l, `go test ./extension/contract -count=1`, `go test -race ./extension/contract -count=1`, and `go build ./...`. Expected PASS. Inspect formatting and preserve concurrent module changes.
- [ ] Commit the three owned files as `fix(dispatch): preserve original JSON payload text`.

## Task 2: Add the lazy payload viewer

**Files:** plugin-dispatch src/payload.tsx, src/json-view.tsx, test/payload.test.tsx, test/json-view.test.tsx, package.json and only its pnpm-lock.yaml importer additions.
**Interfaces:** PayloadView({value:Payload,label:string}) renders a titled section. Job, workflow and cron details consume it next.

- [ ] Add the tests:

### test/payload.test.tsx

```tsx
import { expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PayloadView } from "../src/payload"
vi.mock("../src/json-view",()=>({default:({text,label}:{text:string;label:string})=><pre aria-label={label}>{text}</pre>}))
it("renders original JSON lexemes instead of reserializing rounded numbers",async()=>{
 const text='{"id":9007199254740993,"price":1.2300}'
 render(<PayloadView label="Payload" value={{kind:"json",json:{id:9007199254740992,price:1.23},jsonText:text}} />)
 expect((await screen.findByLabelText("Payload")).textContent).toBe(text)
})
it("qualifies legacy JSON without raw text",()=>{
 render(<PayloadView label="Payload" value={{kind:"json",json:{id:9007199254740992}}} />)
 expect(screen.getByText(/Original JSON text is unavailable/)).toBeTruthy()
 expect(screen.queryByText(/9007199254740992/)).toBeNull()
})
it.each(["gob","binary"] as const)("labels %s without decoding it",kind=>{
 render(<PayloadView label="Data" value={{kind,bytes:42}} />)
 expect(screen.getByText(/42 bytes/)).toBeTruthy()
 expect(screen.getByText(/Not viewable as JSON/)).toBeTruthy()
})
```

### test/json-view.test.tsx

```tsx
import { expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { EditorView } from "@codemirror/view"
import JsonView from "../src/json-view"
it("keeps the editor read only while preserving source text",()=>{
 const text='{"id":9007199254740993,"amount":1.2300}'
 const {unmount}=render(<JsonView text={text} label="Job payload" />)
 const content=screen.getByLabelText("Job payload")
 const view=EditorView.findFromDOM(content)!
 expect(view.state.doc.toString()).toBe(text)
 expect(view.state.readOnly).toBe(true)
 expect(content.getAttribute("aria-readonly")).toBe("true")
 unmount()
 expect(view.destroyed).toBe(true)
})
```

- [ ] Run `pnpm --filter @forge-go/dashboard-plugin-dispatch exec vitest run test/payload.test.tsx test/json-view.test.tsx`. Expected FAIL: missing payload and JSON viewer modules.
- [ ] Add these package.json dependencies and run `pnpm install --filter @forge-go/dashboard-plugin-dispatch --ignore-scripts`. Inspect the lock diff and preserve concurrent entries.

```json
{
  "@codemirror/commands": "^6.11.1",
  "@codemirror/lang-json": "^6.0.2",
  "@codemirror/language": "^6.12.4",
  "@codemirror/search": "^6.7.2",
  "@codemirror/state": "^6.7.6",
  "@codemirror/view": "^6.43.13"
}
```

- [ ] Add the implementation:

### src/payload.tsx

```tsx
import { lazy, Suspense } from "react"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Section } from "./components"

export type Payload = {kind:"json"; json?:unknown; jsonText?:string} | {kind:"gob"|"binary"; bytes:number}
const JsonView = lazy(()=>import("./json-view"))
export function PayloadView({value,label}:{value:Payload;label:string}) {
 return <Section title={label}>{value.kind==="json" ? typeof value.jsonText==="string" ?
  <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Loading JSON viewer…</p>}><JsonView text={value.jsonText} label={label} /></Suspense> :
  <p className="text-xs text-muted-foreground">Original JSON text is unavailable. Update the Dispatch server to inspect this payload without losing numeric precision.</p> :
  value.bytes===0 ? <NoneCell label={label.toLowerCase()} /> :
  <p className="text-xs text-muted-foreground">{value.kind==="gob"?"Gob":"Binary"} payload · {value.bytes.toLocaleString()} bytes · Not viewable as JSON</p>
 }</Section>
}
```

### src/json-view.tsx

```tsx
import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { json } from "@codemirror/lang-json"
import { codeFolding, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language"
import { search, searchKeymap } from "@codemirror/search"
import { defaultKeymap } from "@codemirror/commands"

const theme=EditorView.theme({
 "&":{fontSize:"12px",color:"var(--foreground)",backgroundColor:"transparent"},
 ".cm-scroller":{fontFamily:"var(--font-mono, ui-monospace, monospace)",lineHeight:"1.55"},
 ".cm-gutters":{backgroundColor:"transparent",color:"var(--muted-foreground)",borderRight:"1px solid var(--border)"},
 "&.cm-focused":{outline:"2px solid var(--ring)",outlineOffset:"2px"},
 ".cm-panels":{backgroundColor:"var(--muted)",color:"var(--foreground)"},
})
export default function JsonView({text,label}:{text:string;label:string}) {
 const host=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  if(!host.current)return
  const view=new EditorView({parent:host.current,state:EditorState.create({
   doc:text,extensions:[lineNumbers(),codeFolding(),foldGutter(),syntaxHighlighting(defaultHighlightStyle),json(),
   search({top:true}),keymap.of([...defaultKeymap,...searchKeymap,...foldKeymap]),
   EditorState.readOnly.of(true),EditorView.contentAttributes.of({"aria-label":label,"aria-readonly":"true"}),theme],
  })})
  return ()=>view.destroy()
 },[text,label])
 return <div ref={host} className="max-h-80 overflow-auto rounded-md border" />
}
```

- [ ] Run package format, lint, typecheck and all tests. Expected PASS.
- [ ] Commit exact files as `feat(dispatch): add lossless lazy payload viewer`.

## Final verification

- [ ] One fresh final review across the owned backend and frontend diffs, then one regression-tested fix pass for consequential findings.
- [ ] Record checks and remaining browser/bundle gates, commit and push verified work.
