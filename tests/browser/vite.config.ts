import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
});
