import { defineConfig } from 'vitest/config';

// Relative base so the build works under any GitHub Pages sub-path (/<repo>/).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
