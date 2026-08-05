import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createBuildDefines, loadBuildProfile } from './scripts/build-profile-config.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootDir = fileURLToPath(new URL(".", import.meta.url))
  const profile = loadBuildProfile(rootDir, mode === "external" ? "external" : "internal")

  return {
    plugins: [react()],
    define: createBuildDefines(profile),
    server: {
      watch: {
        ignored: [
          "**/dist/**",
          "**/dist-external/**",
          "**/.dist-build-backups/**",
          "**/.dist-staging-*/**",
        ],
      },
    },
    build: {
      minify: "esbuild",
      sourcemap: false,
      target: "chrome111",
      reportCompressedSize: true,
      rollupOptions: {
        input: {
          app: resolve(rootDir, "index.html"),
        },
      },
    },
  }
})
