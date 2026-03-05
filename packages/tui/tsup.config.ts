import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./index.tsx'],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtension() {
    return { js: '.mjs' };
  }
});
