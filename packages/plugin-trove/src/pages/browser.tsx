import type { ComponentType } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { TROVE_MOUNT, useBrowserLocation } from "../browser-location"
import { PathBar } from "../components/path-bar"

/**
 * One bucket, browsed by prefix. Lazy: the plugin entry reaches this file only
 * through lazy(), so its listing, inspector and upload code stay out of the
 * shell's entry chunk.
 *
 * The store comes from the URL, not from the store picker, so a copied link
 * opens the same store. "" means the default.
 */
const BrowserPage: ComponentType<PluginPageProps> = ({ params }) => {
  const bucket = params.bucket ?? ""
  const { store, prefix } = useBrowserLocation()

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <PluginLink to={`${TROVE_MOUNT}/buckets`} className="hover:underline">
          Buckets
        </PluginLink>
      </nav>
      <PageHeader title={bucket} description="Objects as the driver lists them, one prefix at a time." />
      {store !== "" ? (
        <p className="text-sm text-muted-foreground">
          Store <span className="font-mono text-xs text-foreground">{store}</span>
        </p>
      ) : null}
      <PathBar key={prefix} bucket={bucket} store={store} prefix={prefix} />
    </section>
  )
}

export default BrowserPage
