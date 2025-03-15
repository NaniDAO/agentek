import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./index.ts'],
  format: ['esm', 'cjs'],
  // Skip DTS generation for now since there are issues with references
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.js'
    };
  }
});
