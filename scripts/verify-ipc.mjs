import fs from 'node:fs';

const preload=['preload.cjs','viewer-preload.cjs'].map(name=>fs.readFileSync(new URL(`../electron/${name}`,import.meta.url),'utf8')).join('\n');
const main=fs.readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
const invoked=[...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match=>match[1]);
const handled=new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match=>match[1]));
const missing=[...new Set(invoked)].filter(channel=>!handled.has(channel));
if(missing.length)throw new Error(`Preload IPC channels without handlers: ${missing.join(', ')}`);
console.log(`Verified ${new Set(invoked).size} preload IPC channels.`);
