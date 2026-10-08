import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon, LibraryIcon, WorkflowIcon } from "@forge-go/dashboard-kit/icons"
import { CollectionsPage } from "./pages/collections"
import { OverviewPage } from "./pages/overview"
import { PipelinePage } from "./pages/pipeline"

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
    { label: "Pipeline", to: "/pipeline", priority: 40, icon: <WorkflowIcon />, group: "RAG" },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: "/collections", element: CollectionsPage },
    { path: "/pipeline", element: PipelinePage },
  ],
})

export { CollectionsPage, OverviewPage, PipelinePage }

export default weavePlugin
