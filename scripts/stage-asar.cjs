const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version || '')) {
  throw new Error(`Invalid package version: ${version}`);
}
const releaseRoot = path.resolve(root, 'release');
const staging = path.join(root, 'release', `app-staging-${version.replace(/\./g, '')}`);
const asarOut = path.join(root, 'release', `app-${version}.asar`);
const targetAsar = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');

console.log('Staging app files to:', staging);
if (path.dirname(path.resolve(staging)) !== releaseRoot || path.resolve(staging) === releaseRoot) {
  throw new Error(`Unsafe staging path: ${staging}`);
}
if (fs.existsSync(staging)) {
  fs.rmSync(staging, { recursive: true, force: true });
}
fs.mkdirSync(staging, { recursive: true });

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

copyRecursive(path.join(root, 'dist'), path.join(staging, 'dist'));
copyRecursive(path.join(root, 'electron'), path.join(staging, 'electron'));
copyRecursive(path.join(root, 'build'), path.join(staging, 'build'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(staging, 'package.json'));

console.log('Packing asar...');
execSync(`npx.cmd asar pack "${staging}" "${asarOut}"`, { stdio: 'inherit' });

console.log('Copying to win-unpacked resources...');
fs.copyFileSync(asarOut, targetAsar);
console.log('Done! app.asar successfully replaced in release/win-unpacked/resources/app.asar');
