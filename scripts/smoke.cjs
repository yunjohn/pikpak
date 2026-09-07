const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const target = path.resolve(root, process.argv[2] || `release/smoke-${version}.png`);
const evalScript = process.argv[3] || '';

console.log('Running smoke test target:', target, 'evalScript:', evalScript);

const exe = path.join(root, 'release', 'win-unpacked', 'PikPak Desktop.exe');
if (!fs.existsSync(exe)) {
  console.error(`Unpacked executable not found: ${exe}`);
  process.exit(1);
}
const env = {
  ...process.env,
  PIKPAK_SMOKE_SCREENSHOT: target,
  PIKPAK_SMOKE_EVAL: evalScript,
  PIKPAK_SMOKE_EXIT: '1'
};

cp.spawnSync(exe, [], { env, stdio: 'inherit' });

if (fs.existsSync(target)) {
  const size = fs.statSync(target).size;
  console.log(`Success! Captured screenshot: ${target} (${size} bytes)`);
} else {
  console.error('Screenshot file was not generated!');
  process.exit(1);
}
