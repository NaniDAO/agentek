import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';

// Serial TypeScript builds. Dependencies stay external; consumers can tree-shake
// individual modules instead of receiving duplicated package-wide bundles.
const directory = process.cwd();
const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const gym = manifest.name === '@agentek/gym';
const rootDir = gym ? resolve(directory, 'src') : directory;
const configPath = ts.findConfigFile(directory, ts.sys.fileExists);
const raw = ts.readConfigFile(configPath, ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(raw.config, ts.sys, directory);
const files = config.fileNames.filter(file => !file.endsWith('.test.ts'));
const entries = manifest.name === '@agentek/ai-sdk' ? ['index', 'tool', 'toolkit'] : ['index'];
const formats = manifest.name === '@agentek/cli' || gym ? ['esm'] : ['esm', 'cjs'];
const diagnosticHost = {getCanonicalFileName: f => f, getCurrentDirectory: () => directory, getNewLine: () => '\n'};
rmSync(join(directory, 'dist'), {recursive: true, force: true});
for (const format of formats) {
  const outDir = join(directory, 'dist', ...(gym ? [] : [format]));
  const options = {...config.options, rootDir, outDir, composite: false, incremental: false,
    noEmit: false, emitDeclarationOnly: false, declaration: true, declarationMap: true, sourceMap: true,
    module: format === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Bundler, resolvePackageJsonExports: true};
  // Node's export conditions select the corresponding dependency declarations.
  if (format === 'cjs') { options.noEmitOnError = false; options.moduleResolution = ts.ModuleResolutionKind.Node10; options.resolvePackageJsonExports = false; }
  const program = ts.createProgram(files, options);
  // Type-check with the project's ESM-aware resolver; CJS emission is mechanical.
  if (format === 'esm') {
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) { process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, diagnosticHost)); process.exit(1); }
  }
  const result = program.emit(undefined, (file, content) => {
    mkdirSync(resolve(file, '..'), {recursive: true});
    writeFileSync(file, file.endsWith('.js') ? content.replaceAll('__AGENTEK_VERSION__', JSON.stringify(manifest.version)) : content);
  });
  if (result.emitSkipped) { process.stderr.write(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, diagnosticHost)); process.exit(1); }
  if (gym) continue;
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({type: format === 'esm' ? 'module' : 'commonjs'}));
  for (const entry of entries) {
    const extension = format === 'esm' ? 'mjs' : 'cjs';
    const executable = entry === 'index' && manifest.bin;
    const banner = executable ? '#!/usr/bin/env node\n' : '';
    const target = `./${format}/${entry}.js`;
    const hasDefault = entry !== 'index' && manifest.name === '@agentek/ai-sdk';
    writeFileSync(join(directory, 'dist', `${entry}.${extension}`), banner + (format === 'esm'
      ? `export * from '${target}';\n${hasDefault ? `export {default} from '${target}';\n` : ''}`
      : `module.exports = require('${target}');\n`), {mode: executable ? 0o755 : 0o644});
    const declarations = `export * from '${target}';\n${hasDefault ? `export {default} from '${target}';\n` : ''}`;
    writeFileSync(join(directory, 'dist', `${entry}.${format === 'esm' ? 'd.ts' : 'd.cts'}`), declarations);
  }
}
