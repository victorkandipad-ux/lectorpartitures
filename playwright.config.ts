import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}/`, trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone-portrait', use: { ...devices['iPhone 15'], browserName: 'webkit' } },
    { name: 'iphone-landscape', use: { ...devices['iPhone 15 landscape'], browserName: 'webkit' } },
    // Only for the airplane-mode test: Playwright WebKit cannot navigate offline through a SW.
    { name: 'offline-chromium', grep: /@offline/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: process.env.NOBUILD ? `npx vite preview --port ${PORT} --strictPort` : `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
