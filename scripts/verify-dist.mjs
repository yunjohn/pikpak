import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const html=fs.readFileSync(path.join(root,'dist','index.html'),'utf8');
const references=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]);
const absolute=references.filter(value=>value.startsWith('/'));
if(absolute.length)throw new Error(`Electron file:// build contains absolute asset paths: ${absolute.join(', ')}`);
for(const reference of references){
  if(!reference.startsWith('./'))continue;
  const file=path.join(root,'dist',reference.slice(2));
  if(!fs.existsSync(file))throw new Error(`Missing built asset: ${reference}`);
}
console.log(`Verified ${references.length} relative Electron assets.`);
