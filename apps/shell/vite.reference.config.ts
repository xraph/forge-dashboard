import path from "node:path"
import { defineConfig, mergeConfig } from "vite"
import baseConfig from "./vite.config.ts"

export default mergeConfig(
  baseConfig,
  defineConfig({
    build: {
      outDir: "dist-reference",
      rollupOptions: {
        input: path.resolve(import.meta.dirname, "reference-preview.html"),
      },
    },
  })
)
