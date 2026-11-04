import { defineConfig } from 'vitest/config'

// Long-running robustness runs over the fixtures (not part of `npm test`).
export default defineConfig({
  test: {
    include: ['bench/**/*.run.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
})
