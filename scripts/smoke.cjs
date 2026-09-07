const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const target = process.argv[2] || 'release/smoke-0.39.0.png';
const evalScript = process.argv[3] || '';

console.log('Running smoke test target:', target, 'evalScript:', evalScript);

const exe = 'D:\\dev\\pikpak\\release\\win-unpacked\\PikPak Desktop.exe';
const env = {
  ...process.env,
  PIKPAK_SMOKE_SCREENSHOT: path.resolve(target),
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
