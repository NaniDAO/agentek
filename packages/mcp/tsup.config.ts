import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./index.ts'],
  format: ['esm', 'cjs'],
  dts: false, // Disable dts due to type errors
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  noExternal: [], // To avoid dependency bundling issues
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
