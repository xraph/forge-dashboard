import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base, deliberately. The shell does not know at build time where
  // it is mounted -- WithBasePath("/_forge/dashboard") is legal, and so is a
  // reverse proxy. An absolute base bakes the default mount into both the
  // asset URLs in index.html and Vite's preload resolver for lazy chunks, and
  // a deployment on any other path then 404s every script it asks for.
  // Relative base fixes the chunks: the preload resolver becomes
  // importer-relative. It does NOT fix index.html -- the Go handler rewrites
  // "./assets/ to an absolute URL on the way out, in
  // extensions/dashboard/shell_handlers.go over in the forge repo. See
  // packages/plugin/docs/shell-html-bootstrap.md for why this cannot move into
  // the bootstrap script.
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // The contract lives under /dashboard on the Go server. Proxying it here
    // keeps every request same-origin, so there is no CORS to configure and
    // no cookie to mark SameSite=None just to make dev work.
    proxy: {
      "/dashboard": { target: "http://localhost:8099", changeOrigin: true },
    },
  },
})
