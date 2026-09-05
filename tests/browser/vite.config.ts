import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
  // Next.js's webpack build injects process.env.NODE_ENV via DefinePlugin; this bare Vite
  // harness does not, so any component reading it (e.g. login-form.tsx's dev-login gate)
  // throws "process is not defined" the moment the browser bundle evaluates the module.
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
});
