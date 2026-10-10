import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { DescriptionList } from "../components/presentation"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"

/** `credentials.detail`. */
export interface CredentialsDetail {
  appId: string
  appName: string
  appSlug: string
  publishableKey?: string
  envId?: string
  envName?: string
  envSlug?: string
  isPlatform: boolean
}

/**
 * The publishable key is the one field on this page somebody actually needs
 * to move somewhere else, so it gets a copy button next to it. Copying is
 * best-effort: a denied or unavailable Clipboard API leaves the key visible
 * to select by hand instead of throwing.
 */
function PublishableKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      if (!navigator.clipboard) return
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access denied or unavailable; the key stays visible.
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      <code className="min-w-0 rounded border bg-muted/40 px-3 py-2 text-xs break-all">
        {value}
      </code>
      <Button
        variant="outline"
        size="xs"
        aria-label="Copy publishable key"
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  )
}

/**
 * A read-only summary of which app and environment the operator is looking
 * at, and the publishable key that goes with it.
 */
export function AuthCredentialsPage() {
  const query = useQuery<CredentialsDetail>("credentials.detail")

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Credentials"
        description="Use the publishable key for the selected application and environment."
      />

      <QueryBoundary title="Credentials" query={query} skeletonRows={4}>
        {(data) => (
          <DescriptionList
            items={[
              {
                term: "App",
                value: (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{data.appName}</span>
                    <Badge variant={data.isPlatform ? "outline" : "secondary"}>
                      {data.isPlatform ? "platform" : "app"}
                    </Badge>
                  </span>
                ),
              },
              {
                term: "Slug",
                value: (
                  <span className="font-mono text-xs">{data.appSlug}</span>
                ),
              },
              {
                term: "Environment",
                value: data.envName ? (
                  <span className="flex items-center gap-2">
                    <span>{data.envName}</span>
                    {data.envSlug && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {data.envSlug}
                      </span>
                    )}
                  </span>
                ) : (
                  <NoneCell label="environment" />
                ),
              },
              {
                term: "Publishable key",
                value: data.publishableKey ? (
                  <PublishableKey value={data.publishableKey} />
                ) : (
                  <NoneCell label="publishable key" />
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
