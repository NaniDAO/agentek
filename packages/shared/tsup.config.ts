import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['./index.ts', './client.ts'],
  format: ['esm', 'cjs'],
  dts: true,
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
  target: 'es2022',
  esbuildOptions(options) {
    options.conditions = ['import', 'module'];
  }
});