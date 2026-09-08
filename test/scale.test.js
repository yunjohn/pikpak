import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { filesFrom, nextPageToken, mergeShareFiles, recentFilesFromEvents, normalizeShareList, detectConflicts, generateUniqueName, playbackSourcesFromFile } = require('../electron/core.cjs');

function makeFiles(n, prefix = 'fd') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    kind: i % 3 === 0 ? 'drive#folder' : 'drive#file',
    name: `${prefix}-file-${i}.txt`,
    size: String(i * 100),
    modified_time: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00+08:00`,
    mime_type: i % 2 ? 'text/plain' : 'video/mp4'
  }));
}

describe('large-list scale and robustness', () => {
  it('merges thousands of share files without duplicating known ids', () => {
    const apiFiles = makeFiles(5000);
    const scraped = apiFiles.slice(0, 2500).map(f => ({ ...f, id: f.id, encodedToken: `tok-${f.id}` }));
    const merged = mergeShareFiles(apiFiles, scraped);
    expect(merged).toHaveLength(5000);
    expect(new Set(merged.map(f => f.id)).size).toBe(5000);
    expect(merged.filter(f => f.encodedToken)).toHaveLength(2500);
  });

  it('collapses thousands of recent events to one latest file per id, newest first', () => {
    const uniq = 2000, total = 10000;
    const base = new Date(2024, 0, 1).getTime();
    const events = Array.from({ length: total }, (_, i) => {
      const fileIdx = i % uniq;
      const time = new Date(base + i * 1000).toISOString(); // later events are later in wall-clock order
      return {
        id: `ev-${i}`, file_id: `fd-${fileIdx}`, event_time: time,
        reference_resource: { id: `fd-${fileIdx}`, kind: 'drive#file', name: `file-${fileIdx}.txt`, modified_time: time, trashed: false }
      };
    });
    const files = recentFilesFromEvents(events);
    expect(files).toHaveLength(uniq);
    expect(new Set(files.map(f => f.id)).size).toBe(uniq);
    for (let i = 1; i < files.length; i++) {
      expect(Date.parse(files[i - 1].modified_time)).toBeGreaterThanOrEqual(Date.parse(files[i].modified_time));
    }
  });

  it('normalizes thousands of share items completely', () => {
    const items = Array.from({ length: 5000 }, (_, i) => ({
      share_id: `s-${i}`, title: `share-${i}`, share_url: `https://example.invalid/s/x${i}`,
      pass_code: String(1234 + i), create_time: '2024-01-01T00:00:00+08:00', file_size: String(i)
    }));
    const list = normalizeShareList(items);
    expect(list).toHaveLength(5000);
    expect(list[4999].id).toBe('s-4999');
    expect(list.every(item => item.kind === 'pikpak#share' && item.name)).toBe(true);
  });

  it('accumulates files across many pages without losing or duplicating rows', () => {
    const pages = [];
    for (let p = 0; p < 6; p++) pages.push({ files: makeFiles(100, p.toString()), next_page_token: p < 5 ? `tok-${p}` : '' });
    const all = [];
    for (const page of pages) {
      all.push(...filesFrom(page));
      if (!nextPageToken(page)) break;
    }
    expect(all).toHaveLength(6 * 100);
    expect(all[599].id).toBe('5-99');
  });

  it('maps thousands of source/target names through a linear conflict lookup', () => {
    const targets = Array.from({ length: 2000 }, (_, i) => ({ name: `file-${i}.txt` }));
    const sources = Array.from({ length: 2000 }, (_, i) => ({ name: `file-${i}.txt` }));
    const { conflicts, nonConflicts } = detectConflicts(sources, targets);
    expect(conflicts).toHaveLength(2000);
    expect(nonConflicts).toHaveLength(0);
  });

  it('finds a unique name among thousands of existing names', () => {
    const existing = Array.from({ length: 3000 }, (_, i) => `file-${i}.txt`);
    const name = generateUniqueName('file-0.txt', existing);
    expect(existing.map(n => n.toLowerCase())).not.toContain(name.toLowerCase());
    expect(name).toMatch(/^file-0 - 副本\d*\.txt$/);
  });

  it('dedupes many media entries into a single unique source playlist', () => {
    const medias = Array.from({ length: 300 }, (_, i) => ({
      link: { url: `https://example.invalid/m/${i % 5}` }, // only 5 distinct urls
      is_origin: i % 2 === 0,
      resolution_name: `${[480, 720, 1080][i % 3]}p`
    }));
    const sources = playbackSourcesFromFile({ medias, web_content_link: 'https://example.invalid/web.mp4' });
    const urls = new Set(sources.map(s => s.url));
    expect(urls.size).toBe(sources.length);
    expect(sources.every(s => /^https?:\/\//i.test(s.url))).toBe(true);
    expect(sources.length).toBeLessThanOrEqual(6); // 5 media variants + the "original file" direct link
  });
});
