const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const appVersion = require(path.join(root, 'package.json')).version;
const outputDirectory = `release-${appVersion}-win`;
const args = [require.resolve('electron-builder/cli.js'), '--win', 'portable', `--config.directories.output=${outputDirectory}`];
const electronVersion = require('electron/package.json').version;

function cachedElectronDirectory() {
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  const expected = `electron-v${electronVersion}-win32-${process.arch}.zip`;
  if (!process.env.LOCALAPPDATA || !fs.existsSync(cacheRoot)) return '';
  const matches = [];
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(cacheRoot, entry.name, expected);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && stat.size > 10 * 1024 * 1024) matches.push({ directory: path.dirname(candidate), mtimeMs: stat.mtimeMs });
    } catch {}
  }
  return matches.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.directory || '';
}

if (fs.existsSync(electronDist)) {
  args.push(`--config.electronDist=${electronDist}`);
  console.log('Packaging with installed Electron runtime:', electronDist);
} else {
  const cachedElectron = cachedElectronDirectory();
  if (cachedElectron) {
    args.push(`--config.electronDist=${cachedElectron}`);
    console.log('Packaging with cached Electron runtime:', cachedElectron);
  } else {
    console.log('Local Electron runtime is unavailable; downloading through electron-builder.');
  }
}

const result = cp.spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
