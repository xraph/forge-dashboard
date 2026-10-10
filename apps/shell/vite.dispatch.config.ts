import type { IncomingMessage } from "node:http"
import { readFileSync, statSync } from "node:fs"
import { defineConfig, mergeConfig } from "vite"
import type { UserConfig } from "vite"
import shared from "./vite.config.ts"

// Local qualification only. Credentials remain in the private Go host state.
export default defineConfig(() => {
  const statePath = process.env.DISPATCH_OPERATOR_STATE
  if (!statePath || (statSync(statePath).mode & 0o777) !== 0o600)
    throw new Error("A private operator state file is required")
  const role = process.env.DISPATCH_OPERATOR_ROLE ?? "reader"
  if (!["reader", "payload", "commander", "denied", "anonymous"].includes(role))
    throw new Error("Unknown operator fixture role")
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    url: string
    credentials: Record<string, { token: string; subject: string }>
  }
  const upstream = new URL(state.url)
  if (
    upstream.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(upstream.hostname)
  )
    throw new Error("The operator host must use numeric loopback")
  const credential = role === "anonymous" ? undefined : state.credentials[role]
  if (role !== "anonymous" && (!credential?.token || !credential.subject))
    throw new Error("Operator fixture credential is missing")
  const dropIntent = process.env.DISPATCH_OPERATOR_DROP_FIRST_RESPONSE
  if (
    dropIntent &&
    ![
      "durable.start",
      "durable.signal",
      "durable.signalStart",
      "durable.cancel",
    ].includes(dropIntent)
  )
    throw new Error("Unknown operator fixture response fault")
  const intents = new WeakMap<IncomingMessage, string>()
  let dropped = false
  const qualification: UserConfig = {
    server: {
      host: "127.0.0.1",
      proxy: {
        "/dashboard": {
          target: upstream.origin,
          rewrite: (path: string) => path.replace(/^\/dashboard/, ""),
          configure(proxy) {
            // Lose only the first successful selected response, after the real
            // Go handler has committed. Every retry still reaches that handler.
            proxy.on("proxyRes", (upstreamResponse, request, response) => {
              if (
                !dropped &&
                dropIntent &&
                intents.get(request) === dropIntent &&
                upstreamResponse.statusCode === 200
              ) {
                dropped = true
                upstreamResponse.resume()
                response.destroy()
                console.info(
                  "Operator fixture dropped one accepted command response"
                )
              }
            })
          },
        },
      },
    },
    plugins: [
      {
        name: "dispatch-operator-qualification",
        enforce: "pre",
        // The host supplies contract HTTP, not the dashboard bootstrap endpoints.
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/dashboard/")) {
              for (const name of Object.keys(request.headers)) {
                if (
                  [
                    "cookie",
                    "authorization",
                    "proxy-authorization",
                    "forwarded",
                  ].includes(name) ||
                  name.startsWith("x-")
                )
                  delete request.headers[name]
              }
              if (credential)
                request.headers.authorization = `Bearer ${credential.token}`
            }
            if (
              dropIntent &&
              request.method === "POST" &&
              request.url === "/dashboard/api/dashboard/v1"
            ) {
              const chunks: Buffer[] = []
              let size = 0
              request.on("data", (chunk: Buffer) => {
                size += chunk.length
                if (size <= 3 << 20) chunks.push(chunk)
              })
              request.on("end", () => {
                if (size <= 3 << 20) {
                  try {
                    const envelope = JSON.parse(
                      Buffer.concat(chunks).toString("utf8")
                    )
                    if (envelope.kind === "command")
                      intents.set(request, envelope.intent)
                  } catch {
                    /* The real handler rejects malformed requests. */
                  }
                }
              })
            }
            const documents: Record<string, unknown> = {
              "/dashboard/api/dashboard/v1/principal": {
                authenticated: true,
                subject: credential?.subject ?? "anonymous-fixture",
                displayName: "Operator fixture",
                email: "",
              },
              "/dashboard/api/dashboard/v1/capabilities": {
                shellEnvelopes: ["v1"],
                contributors: [
                  { name: "dispatch", configured: true, envelopes: ["v1"] },
                ],
              },
            }
            if (
              request.url?.startsWith("/dashboard/") &&
              !(
                request.method === "GET" &&
                (documents[request.url] ||
                  request.url === "/dashboard/api/dashboard/v1/csrf")
              ) &&
              !(
                request.method === "POST" &&
                request.url === "/dashboard/api/dashboard/v1"
              )
            ) {
              response.statusCode = 404
              response.end()
              return
            }
            if (request.method !== "GET" || !documents[request.url ?? ""])
              return next()
            response.setHeader("Content-Type", "application/json")
            response.setHeader("Cache-Control", "no-store")
            response.end(JSON.stringify(documents[request.url!]))
          })
        },
        transform(_source: string, id: string) {
          if (!id.endsWith("/src/App.tsx")) return
          return {
            code: `import { ForgeDashboard } from "@forge-go/dashboard-host"; import dispatchPlugin from "@forge-go/dashboard-plugin-dispatch"; const config = { basePath: "/dashboard", authEnabled: true }; export function App() { return <ForgeDashboard config={config} plugins={[dispatchPlugin]} /> }`,
            map: null,
          }
        },
      },
    ],
  }
  return mergeConfig(shared, qualification)
})
