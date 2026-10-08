import { lazy, Suspense } from "react"
import { definePlugin, type PluginPageProps } from "@forge-go/dashboard-plugin"
import { ShieldIcon } from "@forge-go/dashboard-kit/icons"
import { collections, label, type Collection } from "./types"
import {
  CollectionPage,
  DetailPage,
  OverviewPage,
  SettingsPage,
} from "./pages/read"
import { PrivacyPage } from "./pages/privacy"
const Editor = lazy(() => import("./pages/editor"))
export { CollectionPage, DetailPage, OverviewPage, SettingsPage, PrivacyPage }
export type * from "./types"
function editor(collection: Collection) {
  return function ShieldEditor(props: PluginPageProps) {
    return (
      <Suspense
        fallback={
          <p role="status" className="p-3 text-sm text-muted-foreground">
            Loading configuration editor…
          </p>
        }
      >
        <Editor {...props} collection={collection} />
      </Suspense>
    )
  }
}
export const shieldPlugin = definePlugin({
  extension: "shield",
  namespace: "shield",
  label: "Shield",
  icon: <ShieldIcon />,
  nav: [
    { label: "Overview", to: "/", group: "Shield" },
    ...collections.map((collection) => ({
      label: label(collection),
      to: `/${collection}`,
      group:
        collection === "profiles" || collection === "policies"
          ? "Composition"
          : "Safety primitives",
    })),
    { label: "Scans", to: "/scans", group: "Review" },
    { label: "PII vault", to: "/pii", group: "Review" },
    { label: "Compliance", to: "/compliance", group: "Review" },
    { label: "Settings", to: "/settings", group: "Shield" },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    ...collections.flatMap((collection) => [
      {
        path: `/${collection}`,
        element: (props: PluginPageProps) => (
          <CollectionPage {...props} collection={collection} />
        ),
      },
      { path: `/${collection}/new`, element: editor(collection) },
      { path: `/${collection}/:id/edit`, element: editor(collection) },
      {
        path: `/${collection}/:id`,
        element: (props: PluginPageProps) => (
          <DetailPage {...props} collection={collection} />
        ),
      },
    ]),
    {
      path: "/scans",
      element: (props: PluginPageProps) => (
        <CollectionPage {...props} collection="scans" />
      ),
    },
    {
      path: "/scans/:id",
      element: (props: PluginPageProps) => (
        <DetailPage {...props} collection="scans" />
      ),
    },
    { path: "/pii", element: PrivacyPage },
    {
      path: "/compliance",
      element: (props: PluginPageProps) => (
        <CollectionPage {...props} collection="compliance" />
      ),
    },
    {
      path: "/compliance/:id",
      element: (props: PluginPageProps) => (
        <DetailPage {...props} collection="compliance" />
      ),
    },
    { path: "/settings", element: SettingsPage },
  ],
})
export default shieldPlugin
