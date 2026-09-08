import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { offlineTaskState, buildOfflineTaskAction, findMagnetLink, magnetIdentity, parseExternalSearchHtml } = require('../electron/core.cjs');
const { ClipboardMagnetMonitor } = require('../electron/clipboard-monitor.cjs');

describe('offline download task model', () => {
  it('classifies each PikPak phase into a stable state and label', () => {
    expect(offlineTaskState({ phase: 'PHASE_TYPE_RUNNING' })).toMatchObject({ state: 'running', label: '下载中', isTerminal: false });
    expect(offlineTaskState({ phase: 'PHASE_TYPE_COMPLETE' })).toMatchObject({ state: 'completed', label: '已完成', isTerminal: true });
    expect(offlineTaskState({ phase: 'PHASE_TYPE_ERROR' })).toMatchObject({ state: 'failed', label: '失败', isTerminal: true, canRetry: true });
    expect(offlineTaskState({ phase: 'PHASE_TYPE_PAUSED' })).toMatchObject({ state: 'paused', label: '已暂停', isTerminal: false });
    expect(offlineTaskState({ phase: 'PHASE_TYPE_PENDING' })).toMatchObject({ state: 'waiting', label: '等待中', isTerminal: false });
  });

  it('handles a lower/mixed-case phase and a missing phase', () => {
    expect(offlineTaskState({ phase: 'phase_type_running' }).state).toBe('running');
    expect(offlineTaskState({}).state).toBe('waiting');
    expect(offlineTaskState({}).label).toBe('等待中');
  });

  it('normalizes progress that is fractional (0-1) or percentage (0-100)', () => {
    expect(offlineTaskState({ phase: 'PHASE_TYPE_RUNNING', progress: 0.5 }).percent).toBe(50);
    expect(offlineTaskState({ phase: 'PHASE_TYPE_RUNNING', progress: 75 }).percent).toBe(75);
    expect(offlineTaskState({ phase: 'PHASE_TYPE_RUNNING' }).percent).toBe(0);
    expect(offlineTaskState({ phase: 'PHASE_TYPE_COMPLETE', progress: 120 }).percent).toBe(100);
  });

  it('builds only the verified delete request descriptor', () => {
    const spec = buildOfflineTaskAction('delete', 'task-42');
    expect(spec.method).toBe('DELETE');
    expect(spec.path).toBe('/drive/v1/tasks');
    expect(spec.query).toEqual({ task_ids: 'task-42', delete_files: 'false' });
    expect(spec.body).toBeUndefined();
  });

  it('refuses to guess pause/resume/retry endpoints until verified', () => {
    for (const action of ['pause', 'resume', 'retry']) {
      expect(() => buildOfflineTaskAction(action, 'task-42')).toThrow(/离线任务操作「/);
    }
  });

  it('requires a task id for any action', () => {
    expect(() => buildOfflineTaskAction('delete', '')).toThrow('缺少离线任务 ID');
  });
});

describe('clipboard magnet detection', () => {
  it('finds a magnet link inside surrounding text', () => {
    const magnet = 'magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGH&dn=file.mkv';
    expect(findMagnetLink(`下载 ${magnet} 到网盘`)).toBe(magnet);
    expect(findMagnetLink(magnet)).toBe(magnet);
    expect(findMagnetLink(`magnet:?xt=urn:btmh:1220abcdef&dn=a`)).toBe('magnet:?xt=urn:btmh:1220abcdef&dn=a');
    expect(findMagnetLink(`请下载（${magnet}）。`)).toBe(magnet);
    expect(magnetIdentity(`${magnet}&tr=https%3A%2F%2Ftracker.test`)).toBe('urn:btih:abcdefghijklmnopqrstuvwxyz234567abcdefgh');
    const trackerHeavy='magnet:?xt=urn:btih:7774c1f8c9c16a43eddd39d55716e48f47442354&tr=http%3A%2F%2Fbvarf.tracker.sh%3A2086%2Fannounce&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce ';
    expect(findMagnetLink(trackerHeavy)).toHaveLength(trackerHeavy.length-1);
    expect(magnetIdentity(trackerHeavy)).toBe('urn:btih:7774c1f8c9c16a43eddd39d55716e48f47442354');
  });

  it('rejects text without a usable magnet link', () => {
    expect(findMagnetLink('https://example.com/a')).toBeNull();
    expect(findMagnetLink('magnet:?dn=no-xt')).toBeNull(); // lacks xt=urn:
    expect(findMagnetLink('')).toBeNull();
    expect(findMagnetLink('普通文本 没有磁力')).toBeNull();
  });
});

describe('external search result parsing',()=>{
  it('extracts titles and deduplicates magnets from html',()=>{const html=`<article><h3>资源 A &amp; 续集</h3><a href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&tr=one">下载</a></article><article><b>重复资源</b><a href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&tr=two">磁力</a></article>`;expect(parseExternalSearchHtml(html)).toEqual([{title:'资源 A & 续集',magnet:'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&tr=one',key:'urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}])});
  it('decodes ampersands from a real table-style magnet href',()=>{const html=`<tr><td><a href="/view/2/hash" title="真实标题">真实标题</a></td><td><a href="magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&amp;tr=udp%3A%2F%2Ftracker.test">磁力</a></td></tr>`;expect(parseExternalSearchHtml(html)[0]).toMatchObject({title:'真实标题',magnet:'magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&tr=udp%3A%2F%2Ftracker.test'})});
  it('does not mix table headers or notices into the first result title',()=>{const html=`<p>地址发布页</p><table><tr><th>Category</th><th>Name</th></tr><tr><td>Video</td><td><a href="/view/2/hash" title="第一条标题">第一条标题</a><a href="magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccccc">磁力</a></td></tr></table>`;expect(parseExternalSearchHtml(html)[0].title).toBe('第一条标题')});
});

describe('clipboard magnet monitor behavior', () => {
  const magnet='magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGH&dn=file.mkv';
  function setup(overrides={}) {
    let text=magnet, now=0;
    const submitted=[],notifications=[];
    const monitor=new ClipboardMagnetMonitor({readText:()=>text,findMagnet:findMagnetLink,identity:magnetIdentity,isEnabled:()=>true,isAuthenticated:()=>true,submit:async value=>{submitted.push(value);return {id:'task-1'}},notify:value=>notifications.push(value),warn:()=>{},now:()=>now,...overrides});
    return {monitor,submitted,notifications,setText:value=>{text=value},setNow:value=>{now=value}};
  }
  it('processes an unhandled magnet already present when monitoring starts',async()=>{const state=setup();state.monitor.prime();await state.monitor.tick();expect(state.submitted).toEqual([magnet])});
  it('deduplicates equivalent magnets by xt identity',async()=>{const state=setup();state.monitor.prime();state.setText(`${magnet}&tr=one`);await state.monitor.tick();state.setText('');await state.monitor.tick();state.setText(`${magnet}&tr=two`);await state.monitor.tick();expect(state.submitted).toHaveLength(1)});
  it('retries transient failures with backoff and reports final failure',async()=>{let attempts=0;const state=setup({submit:async()=>{attempts++;throw new Error('offline')}});state.monitor.prime();state.setText(`新内容 ${magnet}`);await state.monitor.tick();expect(attempts).toBe(1);state.setNow(4999);await state.monitor.tick();expect(attempts).toBe(1);state.setNow(5000);await state.monitor.tick();state.setNow(15000);await state.monitor.tick();expect(attempts).toBe(3);expect(state.notifications.at(-1)).toMatchObject({ok:false})});
});
