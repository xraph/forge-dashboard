import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // The contract lives under /dashboard on the Go server. Proxying it here
    // keeps every request same-origin, so there is no CORS to configure and
    // no cookie to mark SameSite=None just to make the playground work.
    proxy: {
      "/dashboard": { target: "http://localhost:8099", changeOrigin: true },
    },
  },
})
