import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const extensionRoot = resolve(import.meta.dirname, '..');
const sharedDist = resolve(extensionRoot, '../shared/dist');
const sharedOutput = resolve(extensionRoot, 'out/shared');
const extensionOutput = resolve(extensionRoot, 'out/extension.js');
const sharedRuntime = resolve(extensionRoot, 'out/shared');

execFileSync('tsc', ['-p', resolve(extensionRoot, 'tsconfig.json')], {
  cwd: extensionRoot,
  stdio: 'inherit'
});

mkdirSync(dirname(sharedOutput), { recursive: true });
cpSync(sharedDist, sharedOutput, { recursive: true });

function rewriteSharedImports(directory) {
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      rewriteSharedImports(path);
      continue;
    }
    if (!path.endsWith('.js')) continue;
    const source = readFileSync(path, 'utf8');
    const modulePath = relative(dirname(path), sharedRuntime).replaceAll('\\', '/');
    const sharedImport = modulePath.startsWith('.') ? modulePath : `./${modulePath}`;
    const rewritten = source.replaceAll('require("@aipass/shared")', `require("${sharedImport}")`);
    if (rewritten !== source) writeFileSync(path, rewritten);
  }
}

rewriteSharedImports(resolve(extensionRoot, 'out'));
