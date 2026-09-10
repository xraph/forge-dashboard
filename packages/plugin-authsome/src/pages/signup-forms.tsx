import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/**
 * `AuthSignupFormEditorPage` is defined in `signup-form-editor.tsx` but
 * re-exported here so a single `signup-forms.test.tsx` can import both the
 * list and the editor from this one module, the same pattern `roles.tsx`
 * uses for `role-detail.tsx`. This file does not import anything back from
 * `signup-form-editor.tsx`, so there is no runtime cycle either way.
 */
export { AuthSignupFormEditorPage } from "./signup-form-editor"

/** One row of `formConfigs.list`. */
export interface FormConfigSummary {
  id: string
  formType: string
  version: number
  active: boolean
  createdAt: string
}

export interface FormConfigsList {
  formConfigs: FormConfigSummary[]
}

/**
 * `/signup-forms`: every saved form configuration, unpaged.
 *
 * `formConfigs.list` takes no cursor and no limit and answers its whole
 * collection, the same shape as `roles.list`, so there is no pager here
 * either.
 */
export function AuthSignupFormsPage() {
  const list = useQuery<FormConfigsList>("formConfigs.list")

  const columns: Column<FormConfigSummary>[] = [
    {
      id: "formType",
      header: "Form type",
      cell: (f) => f.formType,
      className: "font-medium",
    },
    { id: "version", header: "Version", cell: (f) => f.version },
    {
      id: "active",
      header: "Active",
      cell: (f) => (
        <Badge variant={f.active ? "outline" : "secondary"}>
          {f.active ? "active" : "inactive"}
        </Badge>
      ),
    },
    { id: "createdAt", header: "Created", cell: (f) => formatTimestamp(f.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Signup forms"
        actions={
          <PluginLink to="/@auth/signup-forms/edit" className="text-sm underline underline-offset-4">
            Edit signup form
          </PluginLink>
        }
      />

      <QueryBoundary title="Signup forms" query={list} skeletonRows={4}>
        {(data) => {
          const formConfigs = data.formConfigs ?? []
          const caption = `${formConfigs.length} ${formConfigs.length === 1 ? "form" : "forms"}`

          return (
            <ResourceTable<FormConfigSummary>
              columns={columns}
              rows={formConfigs}
              rowKey={(f) => f.id}
              caption={caption}
              emptyMessage="No signup forms yet."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
