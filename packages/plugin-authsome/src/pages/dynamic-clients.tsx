import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"

/**
 * `/settings/dynamic-signup`: a read-only view of `auth.dynamicConfig`.
 *
 * Two corrections to what the spec said about this page, both found by reading
 * the Go source rather than the spec.
 *
 * The spec called `auth.dynamicConfig` and `auth.dynamicRegister` "OAuth
 * dynamic client registration". They are not. The handlers' own header comment
 * puts them in the pre-auth bucket alongside `auth.signup`, and they are backed
 * by the same `formconfig.FormConfig` row the signup form editor already edits.
 * There is no client, no client id and no client secret anywhere in the flow.
 *
 * And this page does NOT offer `auth.dynamicRegister`, though an earlier
 * version did. That intent creates a real account in the user table and writes
 * the new account's session cookie over the caller's. An admin who pressed a
 * "test registration" button here would be signed out of their admin session,
 * signed in as an account they had just created, and left with a junk user in
 * production. Labelling the button honestly does not make it a control worth
 * shipping, and the signup form itself is where that flow belongs.
 *
 * What is left is worth having on its own: an admin editing the signup form
 * can see exactly what an unauthenticated visitor will be asked for, including
 * whether the form is in force at all.
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
        title="Dynamic signup form"
        description="What an unauthenticated visitor is asked for, from auth.dynamicConfig"
      />
      <QueryBoundary title="Dynamic signup configuration" query={query} skeletonRows={3}>
        {(data) => {
          if (!data.active) {
            // The config says dynamic registration is disabled - say so
            // rather than rendering a registration form that would only
            // fail once submitted.
            return (
              <p role="status" className="text-sm text-muted-foreground">
                Dynamic registration is disabled. New signups use the static signup form,
                so nothing here is in force.
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
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
