import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          if (!normalizedId.includes("/node_modules/")) {
            return undefined;
          }

          if (
            normalizedId.includes("/node_modules/@codemirror/") ||
            normalizedId.includes("/node_modules/codemirror/") ||
            normalizedId.includes("/node_modules/yaml/")
          ) {
            return "policy-editor";
          }

          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/react-router/") ||
            normalizedId.includes("/node_modules/react-router-dom/") ||
            normalizedId.includes("/node_modules/@remix-run/")
          ) {
            return "react-vendor";
          }

          if (
            normalizedId.includes("/node_modules/@radix-ui/") ||
            normalizedId.includes("/node_modules/@floating-ui/") ||
            normalizedId.includes("/node_modules/sonner/") ||
            normalizedId.includes("/node_modules/class-variance-authority/") ||
            normalizedId.includes("/node_modules/clsx/") ||
            normalizedId.includes("/node_modules/tailwind-merge/")
          ) {
            return "ui-primitives";
          }

          if (normalizedId.includes("/node_modules/lucide-react/")) {
            return "icons";
          }

          return undefined;
        },
      },
    },
  },
});
