"use client"

import dynamic from "next/dynamic"
import corePlugin from "@forge-go/dashboard-plugin-core"
import authsomePlugin from "@forge-go/dashboard-plugin-authsome"
import streamingPlugin from "@forge-go/dashboard-plugin-streaming"

// ForgeDashboard composes a BrowserRouter and base-ui portal components that
// touch `document` during render, not just in effects. The App Router still
// server-renders "use client" pages on first load, which crashes ("document
// is not defined") for anything that assumes a real DOM outside an effect.
// Loading it through next/dynamic with ssr:false skips that server pass and
// mounts it purely on the client, which is what a browser-only SPA needs.
const ForgeDashboard = dynamic(
  () => import("@forge-go/dashboard-host").then((mod) => mod.ForgeDashboard),
  { ssr: false },
)

const plugins = [corePlugin, streamingPlugin, authsomePlugin]
const config = { basePath: "/admin", contractBase: "/api/forge/api/dashboard/v1" }

export default function Page() {
  return <ForgeDashboard basename="/admin" config={config} plugins={plugins} />
}
