import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3102",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mock-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: "npm run dev -- -H 127.0.0.1 -p 3102",
    url: "http://127.0.0.1:3102/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ENABLE_MOCK_ACCOUNTS: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      GEMINI_API_KEY: "",
    },
  },
});
