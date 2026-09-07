import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

copyFileSync(resolve('node_modules/hls.js/dist/hls.min.js'),resolve('electron/hls.min.js'));
console.log('Prepared bundled HLS viewer runtime.');
