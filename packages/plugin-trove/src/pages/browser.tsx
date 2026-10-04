import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@forge-go/dashboard-kit/components/resizable"
import { TROVE_MOUNT, folderOf, useBrowserLocation } from "../browser-location"
import { Inspector } from "../components/inspector"
import { ObjectActions } from "../components/object-actions"
import { ObjectListing } from "../components/object-listing"
import { PathBar } from "../components/path-bar"
import { Preview } from "../components/preview"
import { UploadButton, UploadDropZone, UploadTray } from "../components/upload-tray"
import { withStore } from "../store"
import type { CasStatus, SystemStatus } from "../types"

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
  const { store, prefix, key } = useBrowserLocation()
  const cas = useQuery<CasStatus>("cas.status", withStore(store, {}))
  const casBucket = cas.data?.enabled ? cas.data.bucket : null
  const status = useQuery<SystemStatus>("system.status", withStore(store, {}))
  const maxBytes = status.data?.config.maxUploadBytes ?? null
  const folder = folderOf(prefix)
  const uploadsRefused = casBucket !== null && casBucket === bucket

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <PluginLink to={`${TROVE_MOUNT}/buckets`} className="hover:underline">
          Buckets
        </PluginLink>
      </nav>
      <PageHeader
        title={bucket}
        description="Objects as the driver lists them, one prefix at a time."
        actions={<UploadButton store={store} bucket={bucket} folder={folder} maxBytes={maxBytes} disabled={uploadsRefused} />}
      />
      {uploadsRefused ? (
        <p className="text-sm text-muted-foreground">CAS manages this bucket. Its objects are written through CAS, not uploaded here.</p>
      ) : null}
      {store !== "" ? (
        <p className="text-sm text-muted-foreground">
          Store <span className="font-mono text-xs text-foreground">{store}</span>
        </p>
      ) : null}
      <PathBar key={prefix} bucket={bucket} store={store} prefix={prefix} />
      {/*
        A fixed height, so each panel scrolls on its own. Unbounded, the group
        grows to the listing's height and the inspector sits at its top, off
        screen once the operator scrolls down to a row.
      */}
      <ResizablePanelGroup orientation="horizontal" className="rounded-md border" style={{ height: "calc(100vh - 16rem)", minHeight: "24rem" }}>
        <ResizablePanel defaultSize="62" minSize="35">
          <div className="h-full p-3">
            <UploadDropZone store={store} bucket={bucket} folder={folder} maxBytes={maxBytes} disabled={uploadsRefused}>
              <ObjectListing key={`${store}\n${bucket}\n${prefix}`} store={store} bucket={bucket} prefix={prefix} selectedKey={key} />
              <UploadTray />
            </UploadDropZone>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="38" minSize="25">
          <div className="h-full overflow-auto p-3">
            {key !== "" ? (
              <Inspector key={`${store}\n${bucket}\n${key}`} store={store} bucket={bucket} objectKey={key}>
                {(head) => (
                  <>
                    <ObjectActions store={store} bucket={bucket} prefix={prefix} head={head} casBucket={casBucket} />
                    <Preview key={`${head.object.key}\n${head.object.etag ?? ""}\n${head.object.lastModified ?? ""}`} store={store} bucket={bucket} head={head} />
                  </>
                )}
              </Inspector>
            ) : (
              <p className="text-sm text-muted-foreground">Select an object to see it here.</p>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  )
}

export default BrowserPage
