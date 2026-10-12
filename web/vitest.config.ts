import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    globalSetup: ['tests/support/unit-setup.ts'],
  },
});
