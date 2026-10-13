import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    globalSetup: ['tests/support/unit-setup.ts'],
    // Several tests start other programs (git, node, the sandbox): a second or two alone, past the default 5 s
    // whenever a suite runs beside them.
    testTimeout: 30_000,
  },
});
