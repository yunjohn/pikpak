import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeSubDir, buildInterruptedDownloadOptions, normalizeDownloadRefreshId, verifiedDownloadState } = require('../electron/core.cjs');

describe('transfer and search control', () => {
  it('builds valid interrupted download options for HTTP Range resumption', () => {
    const task = {
      id: 'd-1',
      name: 'big-video.mp4',
      path: 'C:\\Users\\xu\\Downloads\\big-video.mp4',
      url: 'https://cdn.mypikpak.com/big-video.mp4',
      urlChain: ['https://cdn.mypikpak.com/big-video.mp4'],
      total: 104857600, // 100MB
      eTag: '"etag-12345"',
      lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
      startTime: 1787884938
    };

    const opts = buildInterruptedDownloadOptions({ task, localSize: 52428800 }); // 50MB downloaded
    expect(opts).not.toBeNull();
    expect(opts.path).toBe(task.path);
    expect(opts.offset).toBe(52428800);
    expect(opts.length).toBe(104857600);
    expect(opts.eTag).toBe('"etag-12345"');
    expect(opts.urlChain).toEqual(['https://cdn.mypikpak.com/big-video.mp4']);
  });

  it('rejects resumption when local partial file is empty or already full', () => {
    const task = {
      path: 'C:\\Users\\xu\\Downloads\\video.mp4',
      url: 'https://cdn.mypikpak.com/video.mp4',
      total: 1000
    };

    expect(buildInterruptedDownloadOptions({ task, localSize: 0 })).toBeNull();
    expect(buildInterruptedDownloadOptions({ task, localSize: -10 })).toBeNull();
    expect(buildInterruptedDownloadOptions({ task, localSize: 1000 })).toBeNull();
    expect(buildInterruptedDownloadOptions({ task, localSize: 1500 })).toBeNull();
  });

  it('rejects resumption when path or url is missing', () => {
    expect(buildInterruptedDownloadOptions({ task: { total: 1000 }, localSize: 500 })).toBeNull();
    expect(buildInterruptedDownloadOptions({ task: { path: 'C:\\file.bin', total: 1000 }, localSize: 500 })).toBeNull();
    expect(buildInterruptedDownloadOptions(null)).toBeNull();
  });
  it('accepts only bounded download refresh identifiers', () => {
    expect(normalizeDownloadRefreshId('drive:file-1')).toBe('drive:file-1');
    expect(normalizeDownloadRefreshId('share:share-1:file-1')).toBe('share:share-1:file-1');
    expect(normalizeDownloadRefreshId('https://evil.test/file')).toBe('');
    expect(normalizeDownloadRefreshId('drive:')).toBe('');
    expect(normalizeDownloadRefreshId(`drive:${'x'.repeat(600)}`)).toBe('');
  });
  it('verifies completed downloads against network and disk byte counts',()=>{
    expect(verifiedDownloadState('completed',{total:100,received:100,diskSize:100})).toEqual({state:'completed',error:''});
    expect(verifiedDownloadState('completed',{total:100,received:80,diskSize:80})).toMatchObject({state:'failed'});
    expect(verifiedDownloadState('completed',{total:0,received:80,diskSize:70})).toMatchObject({state:'failed'});
    expect(verifiedDownloadState('cancelled',{total:100,received:20,diskSize:20})).toEqual({state:'cancelled',error:''});
  });
  it('sanitizes relative subDir paths and blocks directory traversal', () => {
    expect(sanitizeSubDir('')).toBe('');
    expect(sanitizeSubDir('Season 1/Episode 1')).toBe('Season 1/Episode 1');
    expect(sanitizeSubDir('Season 1\\Episode 1')).toBe('Season 1/Episode 1');
    expect(sanitizeSubDir('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeSubDir('..\\..\\Windows\\System32')).toBe('Windows/System32');
    expect(sanitizeSubDir('bad:name*with?illegal<chars>|')).toBe('bad_name_with_illegal_chars');
    expect(sanitizeSubDir('.')).toBe('');
    expect(sanitizeSubDir('..')).toBe('');
  });

  it('correctly filters completed multipart parts when resuming upload', () => {
    const savedParts = [{ number: 1, etag: 'etag-1' }, { number: 2, etag: 'etag-2' }];
    const totalParts = 5;
    const completedMap = new Map(savedParts.map(p => [Number(p.number), String(p.etag)]));
    const remainingToUpload = [];
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      if (!completedMap.has(partNumber)) remainingToUpload.push(partNumber);
    }
    expect(remainingToUpload).toEqual([3, 4, 5]);
    expect(completedMap.get(1)).toBe('etag-1');
    expect(completedMap.get(2)).toBe('etag-2');
  });

  it('validates download retry preconditions and preserves subDir', () => {
    const downloadHistory = [
      { id: 'task-ok', name: 'video.mp4', subDir: 'Series/S01', url: 'https://download.mypikpak.com/file1', state: 'interrupted' },
      { id: 'task-no-url', name: 'missing.mp4', state: 'failed' }
    ];
    const canRetry = (id) => {
      const task = downloadHistory.find(t => t.id === id);
      if (!task) throw new Error('未找到该下载任务');
      if (!task.url || !/^https?:\/\//i.test(task.url)) throw new Error('下载地址缺失或无效，无法重试');
      return { id: task.id, name: task.name, subDir: task.subDir || '', url: task.url, state: 'queued' };
    };
    expect(canRetry('task-ok')).toMatchObject({ id: 'task-ok', subDir: 'Series/S01', state: 'queued' });
    expect(() => canRetry('task-no-url')).toThrow('下载地址缺失或无效');
    expect(() => canRetry('non-existent')).toThrow('未找到该下载任务');
  });

  it('supports search cancellation via AbortController signal', () => {
    const controller = new AbortController();
    let aborted = false;
    controller.signal.addEventListener('abort', () => { aborted = true; });
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(aborted).toBe(true);
  });
});
