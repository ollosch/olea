import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 8091)
const apiURL = `http://127.0.0.1:${port}`
const baseURL = 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  timeout: 10_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 8'] },
    },
  ],
  webServer: [
    {
      command: 'bash scripts/e2e-server.sh',
      url: `${apiURL}/api/health`,
      name: 'Disposable PocketBase',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { E2E_PORT: String(port) },
    },
    {
      command: 'bun run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      url: baseURL,
      name: 'Vite',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { E2E_API_PORT: String(port) },
    },
  ],
})
