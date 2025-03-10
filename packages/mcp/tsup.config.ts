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
  // No banner - we'll handle the shebang in the build script
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.js'
    };
  }
});