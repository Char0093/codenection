import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const config = [
  ...compat.extends("next/core-web-vitals"),
  // "web/" and "src/" are stray scratch scaffolds outside the Next.js app; linting their
  // build output produced 253 spurious errors and broke `npm run lint`.
  {
    ignores: [
      ".next/**", "node_modules/**", "coverage/**", "superpowers/**",
      "test-results/**", "playwright-report/**", "web/**", "src/**",
    ],
  },
];

export default config;
