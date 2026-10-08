import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import { FileTextIcon, HouseIcon, LibraryIcon, WorkflowIcon } from "@forge-go/dashboard-kit/icons"
import { CollectionCreatePage } from "./pages/collection-create"
import { CollectionDetailPage } from "./pages/collection-detail"
import { CollectionEditPage } from "./pages/collection-edit"
import { CollectionsPage } from "./pages/collections"
import { DocumentsPage } from "./pages/documents"
import { IngestPage } from "./pages/ingest"
import { OverviewPage } from "./pages/overview"
import { PipelinePage } from "./pages/pipeline"

/**
 * The document page. Lazy, so the chunk reader's virtualiser never reaches
 * the shell's entry chunk. PluginHost wraps every page in Suspense, which is
 * what makes a lazy route legal.
 */
const DocumentDetailPage = lazy(() => import("./pages/document-detail"))

/**
 * The first-party UI for the `weave` extension.
 *
 * `extension` is "weave", the contributor name weave/extension/contract's
 * manifest registers, and test/plugin.test.tsx checks it by resolving against
 * a capabilities document. The dashboard is operator-wide: Weave resolves no
 * tenant on this path, so every page sees every tenant unless it filters.
 */
export const weavePlugin = definePlugin({
  extension: "weave",
  namespace: "weave",
  label: "Weave",
  nav: [
    { label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "RAG" },
    { label: "Collections", to: "/collections", priority: 10, icon: <LibraryIcon />, group: "RAG" },
    { label: "Documents", to: "/documents", priority: 20, icon: <FileTextIcon />, group: "RAG" },
    { label: "Pipeline", to: "/pipeline", priority: 40, icon: <WorkflowIcon />, group: "RAG" },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: "/collections", element: CollectionsPage },
    { path: "/collections/new", element: CollectionCreatePage },
    { path: "/collections/:id", element: CollectionDetailPage },
    { path: "/collections/:id/edit", element: CollectionEditPage },
    { path: "/collections/:id/ingest", element: IngestPage },
    { path: "/documents", element: DocumentsPage },
    { path: "/documents/:id", element: DocumentDetailPage },
    { path: "/pipeline", element: PipelinePage },
  ],
})

export { CollectionCreatePage, CollectionDetailPage, CollectionEditPage, CollectionsPage, DocumentsPage, IngestPage, OverviewPage, PipelinePage }

export default weavePlugin
