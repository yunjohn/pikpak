import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource=fs.readFileSync(path.resolve('src/App.vue'),'utf8');

describe('file manager layout',()=>{
  it('keeps file actions out of the top toolbar',()=>{
    const toolbar=appSource.slice(appSource.indexOf('<header class="toolbar">'),appSource.indexOf('<section v-if="mode===\'search\'&&!searchStats"'));
    expect(toolbar).not.toContain('downloadSelected');
    expect(toolbar).not.toContain('createShareSelected');
    expect(toolbar).not.toContain('trashSelected');
  });

  it('renders contextual actions inside the file list and has no directory tree component',()=>{
    const panelStart=appSource.indexOf('<div :class="[\'file-panel\'');
    const batchStart=appSource.indexOf('class="list-batch-actions"');
    const rowsStart=appSource.indexOf('v-for="item in displayFiles"');
    expect(panelStart).toBeGreaterThan(-1);
    expect(batchStart).toBeGreaterThan(panelStart);
    expect(rowsStart).toBeGreaterThan(batchStart);
    expect(appSource).not.toContain('FolderTree');
    expect(appSource).not.toContain('treeExpanded');
  });
});
