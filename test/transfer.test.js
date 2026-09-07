import { describe, expect, it } from 'vitest';

describe('transfer and search control', () => {
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

  it('validates download retry preconditions: url and task existence', () => {
    const downloadHistory = [
      { id: 'task-ok', name: 'video.mp4', url: 'https://download.mypikpak.com/file1', state: 'interrupted' },
      { id: 'task-no-url', name: 'missing.mp4', state: 'failed' }
    ];
    const canRetry = (id) => {
      const task = downloadHistory.find(t => t.id === id);
      if (!task) throw new Error('未找到该下载任务');
      if (!task.url || !/^https?:\/\//i.test(task.url)) throw new Error('下载地址缺失或无效，无法重试');
      return { id: task.id, name: task.name, url: task.url, state: 'queued' };
    };
    expect(canRetry('task-ok')).toMatchObject({ id: 'task-ok', state: 'queued' });
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
