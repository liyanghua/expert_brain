import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ebs/ui-components": path.resolve(root, "../../packages/ui-components/src"),
      "@ebs/ground-truth-schema": path.resolve(
        root,
        "../../packages/ground-truth-schema/src",
      ),
      "@ebs/document-ir": path.resolve(root, "../../packages/document-ir/src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
