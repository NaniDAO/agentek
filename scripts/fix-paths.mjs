#!/usr/bin/env node

import { copyFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

// Packages to process
const packages = ['shared', 'ai-sdk', 'mcp'];

// Process each package
for (const pkg of packages) {
  const distDir = join('packages', pkg, 'dist');
  const esmDir = join(distDir, 'esm');
  const cjsDir = join(distDir, 'cjs');
  
  // Skip if dist directory doesn't exist
  if (!existsSync(distDir)) continue;
  
  // Create the ESM and CJS directories
  mkdirSync(esmDir, { recursive: true });
  mkdirSync(cjsDir, { recursive: true });
  
  // Find all JavaScript files in the dist directory
  const files = readdirSync(distDir)
    .filter(file => file.endsWith('.js') || file.endsWith('.js.map') || file.endsWith('.d.ts'));
  
  // Copy files to esm and cjs directories
  for (const file of files) {
    // Source file path
    const srcPath = join(distDir, file);
    
    // ESM destination
    const esmPath = join(esmDir, file);
    copyFileSync(srcPath, esmPath);
    
    // CJS destination
    const cjsPath = join(cjsDir, file);
    copyFileSync(srcPath, cjsPath);
  }
  
  // Add package.json with type: commonjs in cjs directory
  writeFileSync(
    join(cjsDir, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2)
  );
  
  // Special case for MCP: Make the bin file executable
  if (pkg === 'mcp' && existsSync(join(esmDir, 'index.js'))) {
    execSync(`chmod +x ${join(esmDir, 'index.js')}`);
  }
}

console.log('Fixed package paths successfully!');