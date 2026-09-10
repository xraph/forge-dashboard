import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
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

/**
 * `/settings/dynamic-clients`: `auth.dynamicConfig` and `auth.dynamicRegister`.
 *
 * IMPORTANT NAMING NOTE, read before touching this file: the design spec
 * (`docs/superpowers/specs/2026-09-08-authsome-core-design.md`, "Sign-in
 * belongs to the gate, not to this plugin") describes these two intents as
 * backing "OAuth dynamic client registration". They do not. Verified against
 * `extension/contract/handlers_auth_pages.go` in the `authsome` repository
 * (the Go source these intents are registered from):
 *
 *   auth.dynamicConfig    query,   no input   -> DynamicConfigResponse
 *                         { title?, description?, fields?: FormField[], active }
 *   auth.dynamicRegister  command, DynamicRegisterInput
 *                         { email, password, name?, metadata?: map[string]string }
 *                         -> SignupResponse { ok, subject }
 *
 * That file's own header comment calls these two "form-config-driven"
 * signup, one of "six intents the dashboard's AuthGate dispatches before a
 * session exists" - the same bucket as `auth.signup`. There is no
 * `client_id`, no `redirect_uris`, no client secret and nothing resembling
 * RFC 7591 anywhere in the handler. What this actually is: a per-app
 * *dynamic signup form* (the admin configures extra signup fields in
 * `signup-form-editor.tsx`, via `formConfigs.saveSignup` against the SAME
 * underlying form config `formconfig.FormConfig{FormType: "signup"}`), and
 * `auth.dynamicRegister` is the registration endpoint that form posts to -
 * it creates a REAL account and writes a session cookie onto the current
 * HTTP response, exactly like `auth.signup`.
 *
 * The page below is still built at the file/route the task asked for
 * (`/settings/dynamic-clients`, exported and not yet wired into a route -
 * see the bottom of this file), and still reads `auth.dynamicConfig` /
 * offers `auth.dynamicRegister`. But it is honest about what those calls do:
 * there is no client secret to reveal (`auth.dynamicRegister` returns a
 * session subject, not credentials), and the "register" action is labelled
 * as the live, account-creating test that it is rather than as minting an
 * OAuth client. See the gap-fill report for the full writeup.
 */

/** One entry of `DynamicConfigResponse.fields`, from `formconfig.FormField`. */
export interface DynamicSignupField {
  key: string
  label: string
  type: string
  order: number
}

/** `auth.dynamicConfig`'s response. */
export interface DynamicConfigResponse {
  title?: string
  description?: string
  fields?: DynamicSignupField[]
  active: boolean
}

/** `auth.dynamicRegister`'s response. No secret, no client credentials: a session subject. */
export interface DynamicRegisterResult {
  ok: boolean
  subject: string
}

const STANDARD_KEYS = new Set(["email", "password", "name"])

/**
 * The live test-registration tool.
 *
 * `email` and `password` are the two required top-level slots on
 * `DynamicRegisterInput`; `name` is optional. Any other configured field is
 * not a top-level slot at all - "everything else flows through Metadata so
 * the engine writes it onto User.Metadata" (`handlers_auth_pages.go`) - so
 * this collects those into a `metadata` map keyed by the field's `key`,
 * dropping ones the operator left blank rather than sending empty strings
 * for fields nobody touched.
 */
function DynamicRegisterForm({ fields }: { fields: DynamicSignupField[] }) {
  const register = useCommand<DynamicRegisterResult>("auth.dynamicRegister")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [metadata, setMetadata] = useState<Record<string, string>>({})
  const [result, setResult] = useState<DynamicRegisterResult | null>(null)

  const extraFields = fields.filter((f) => !STANDARD_KEYS.has(f.key))

  async function submit() {
    const meta = Object.fromEntries(Object.entries(metadata).filter(([, v]) => v !== ""))
    const response = await register.execute({
      email,
      password,
      ...(name.trim() !== "" ? { name } : {}),
      ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
    })
    // `execute` resolves with undefined on failure and never rejects, so
    // this is the success check. A failed attempt must not throw away what
    // the operator typed.
    if (response === undefined) return
    setResult(response)
  }

  if (result) {
    return (
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="text-sm font-medium">Registration succeeded</h2>
        <p className="text-sm text-muted-foreground">
          A new account was created (subject{" "}
          <span className="font-mono text-xs">{result.subject}</span>) and this browser&apos;s
          session cookie was replaced with its session. This is not a client secret:{" "}
          <code className="font-mono text-xs">auth.dynamicRegister</code> hands back a session,
          not credentials, so there is nothing further to reveal or copy.
        </p>
        <div>
          <Button variant="outline" onClick={() => setResult(null)}>
            Run again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Test registration</h2>
      <p className="text-sm text-muted-foreground">
        This calls the exact endpoint the dynamic signup form posts to. It creates a real
        account and signs this browser in as it - it is a live action, not a preview.
      </p>
      <CommandAlert error={register.error} title="Could not register" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dynamic-register-email">Email</Label>
        <Input
          id="dynamic-register-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dynamic-register-password">Password</Label>
        <Input
          id="dynamic-register-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dynamic-register-name">Name</Label>
        <Input id="dynamic-register-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {extraFields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5">
          <Label htmlFor={`dynamic-register-field-${field.key}`}>{field.label || field.key}</Label>
          <Input
            id={`dynamic-register-field-${field.key}`}
            value={metadata[field.key] ?? ""}
            onChange={(e) =>
              setMetadata((prev) => ({ ...prev, [field.key]: e.target.value }))
            }
          />
        </div>
      ))}
      <div>
        <Button
          onClick={() => void submit()}
          disabled={register.loading || email.trim() === "" || password.trim() === ""}
        >
          {register.loading ? "Registering…" : "Register"}
        </Button>
      </div>
    </div>
  )
}

export function AuthDynamicClientsPage() {
  const query = useQuery<DynamicConfigResponse>("auth.dynamicConfig")

  const columns: Column<DynamicSignupField>[] = [
    { id: "key", header: "Key", cell: (f) => f.key, className: "font-mono text-xs" },
    {
      id: "label",
      header: "Label",
      cell: (f) => f.label || <NoneCell label="label" />,
      className: "font-medium",
    },
    { id: "type", header: "Type", cell: (f) => f.type },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Dynamic signup"
        description="auth.dynamicConfig / auth.dynamicRegister"
      />
      <QueryBoundary title="Dynamic signup configuration" query={query} skeletonRows={3}>
        {(data) => {
          if (!data.active) {
            // The config says dynamic registration is disabled - say so
            // rather than rendering a registration form that would only
            // fail once submitted.
            return (
              <p role="status" className="text-sm text-muted-foreground">
                Dynamic registration is disabled. New signups use the static signup form; there
                is nothing to configure or test here.
              </p>
            )
          }

          const fields = [...(data.fields ?? [])].sort((a, b) => a.order - b.order)
          const caption = `${fields.length} ${fields.length === 1 ? "field" : "fields"}`

          return (
            <>
              <div className="flex flex-col gap-2 rounded-md border p-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">active</Badge>
                  <span className="text-sm font-medium">{data.title || "Untitled form"}</span>
                </div>
                {data.description && (
                  <p className="text-sm text-muted-foreground">{data.description}</p>
                )}
                <ResourceTable<DynamicSignupField>
                  columns={columns}
                  rows={fields}
                  rowKey={(f) => f.key}
                  caption={caption}
                  emptyMessage="No fields configured."
                />
              </div>

              <DynamicRegisterForm fields={fields} />
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}

/**
 * Not routed here. `src/index.tsx` is owned by another workstream while this
 * page was built, so wiring `AuthDynamicClientsPage` into `routes` at
 * `/settings/dynamic-clients` (with no `nav` entry, per the spec) is left as
 * an explicit follow-up rather than touched.
 */
