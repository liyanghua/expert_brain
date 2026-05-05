import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(root, "..");

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      "@ebs/ground-truth-schema": path.resolve(
        repoRoot,
        "packages/ground-truth-schema/src",
      ),
      "@ebs/document-ir": path.resolve(repoRoot, "packages/document-ir/src"),
    },
  },
  server: {
    port: 5181,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"]
  }
});
