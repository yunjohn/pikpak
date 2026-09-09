const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const target = path.resolve(root, process.argv[2] || `release-${version}-win/smoke-${version}.png`);
const evalScript = process.argv[3] || '';

console.log('Running smoke test target:', target, 'evalScript:', evalScript);

const exe = process.env.PIKPAK_SMOKE_EXE || path.join(root, `release-${version}-win`, 'win-unpacked', 'PikPak Desktop.exe');
if (!fs.existsSync(exe)) {
  console.error(`Unpacked executable not found: ${exe}`);
  process.exit(1);
}
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pikpak-desktop-smoke-'));
const env = {
  ...process.env,
  PIKPAK_SMOKE_SCREENSHOT: target,
  PIKPAK_SMOKE_EVAL: evalScript,
  PIKPAK_SMOKE_EXIT: '1',
  PIKPAK_SMOKE_USER_DATA: smokeUserData
};

try {
  const result = cp.spawnSync(exe, [], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Smoke-test application exited with status ${result.status}`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(smokeUserData, { recursive: true, force: true });
}

if (process.exitCode) {
  process.exit(process.exitCode);
} else if (fs.existsSync(target)) {
  const size = fs.statSync(target).size;
  console.log(`Success! Captured screenshot: ${target} (${size} bytes)`);
} else {
  console.error('Screenshot file was not generated!');
  process.exit(1);
}
