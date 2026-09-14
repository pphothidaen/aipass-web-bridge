import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const vscodeDir = join(root, 'packages', 'vscode-extension');
const chromeSource = join(root, 'packages', 'core', 'aipass-bridge', 'extension');
const releaseDir = join(root, 'release');
const vscodeReleaseDir = join(releaseDir, 'vscode-extension');
const chromeReleaseDir = join(releaseDir, 'chrome-extension');

function run(command, args, cwd = root) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (!existsSync(join(root, 'node_modules'))) {
  run('npm', ['install']);
}

run('npm', ['run', 'build:shared']);
run('npm', ['run', 'build', '-w', 'packages/vscode-extension']);
for (const entry of readdirSync(vscodeDir)) {
  if (entry.endsWith('.vsix')) rmSync(join(vscodeDir, entry), { force: true });
}
run('npm', ['exec', '--workspace', 'packages/vscode-extension', '--', 'vsce', 'package', '--no-dependencies'], root);

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(vscodeReleaseDir, { recursive: true });
mkdirSync(chromeReleaseDir, { recursive: true });

const vsix = readdirSync(vscodeDir).find(name => name.endsWith('.vsix'));
if (!vsix) throw new Error('VS Code package did not produce a .vsix file');
cpSync(join(vscodeDir, vsix), join(vscodeReleaseDir, vsix));

const chromeManifest = readJson(join(chromeSource, 'manifest.json'));
for (const entry of readdirSync(chromeSource)) {
  cpSync(join(chromeSource, entry), join(chromeReleaseDir, entry), { recursive: true });
}

const chromeZip = join(releaseDir, `aipass-bridge-chrome-v${chromeManifest.version}.zip`);
run('zip', ['-qr', chromeZip, '.'], chromeReleaseDir);

console.log('\nRelease artifacts:');
console.log(`- ${join(vscodeReleaseDir, vsix)}`);
console.log(`- ${chromeReleaseDir} (Chrome: Load unpacked)`);
console.log(`- ${chromeZip}`);