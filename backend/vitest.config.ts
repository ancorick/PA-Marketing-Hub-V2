import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each file starts its own embedded Postgres and runs every migration in its first test; with all files in
    // parallel that alone can take several seconds on a laptop, so 5 s (the default) is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
