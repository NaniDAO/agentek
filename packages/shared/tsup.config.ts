import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./index.ts', './client.ts'],
  format: ['esm', 'cjs'],
  // Disable dts generation through tsup, we'll use tsc instead
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.js'
    };
  },
  // Set target to match tsconfig
  target: 'es2022',
  // Fix ESM compatibility
  esbuildOptions(options) {
    options.conditions = ['import', 'module'];
  }
});