import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { filesFrom, nextPageToken, normalizeQuota, normalizeShareList, recentFilesFromEvents, apiErrorMessage, isFileNotFound } = require('../electron/core.cjs');

const fixtureDir = path.resolve('test/fixtures/api');

function load(name) { return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')); }
function allFixtureText() {
  return fs.readdirSync(fixtureDir)
    .filter(file => file.endsWith('.json'))
    .map(file => fs.readFileSync(path.join(fixtureDir, file), 'utf8'))
    .join('\n');
}

describe('sanitized API fixtures', () => {
  it('contains no secrets, tokens, emails, or real endpoints', () => {
    const text = allFixtureText();
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/"access_token"\s*:\s*"[^"]+"/);
    expect(text).not.toMatch(/"refresh_token"\s*:\s*"[^"]+"/);
    expect(text).not.toMatch(/"password"\s*:\s*"[^"]+"/);
    expect(text).not.toMatch(/"client_secret"\s*:\s*"[^"]+"/);
    // every http(s) endpoint must use the reserved placeholder host
    expect(text).not.toMatch(/https?:\/\/(?!example\.invalid\b)[^\s"]+/);
  });

  it('parses the normal drive list into files and the next page token', () => {
    const data = load('drive-list.ok.json');
    const files = filesFrom(data);
    expect(files).toHaveLength(3);
    expect(nextPageToken(data)).toBe('page-token-abc-123');
    expect(files[0].kind).toBe('drive#folder');
    expect(files[1].medias[0].is_origin).toBe(true);
    expect(files[1].starred).toBe(true);
  });

  it('classifies a 401 unauthorized body via the error description', () => {
    const data = load('drive-list.401.json');
    expect(apiErrorMessage(401, data)).toBe('Access token 无效或已过期，请重新登录');
  });

  it('classifies 429 as a rate limit before any generic detail', () => {
    const data = load('drive-list.429.json');
    expect(apiErrorMessage(429, data)).toBe('请求过于频繁，请稍后重试');
  });

  it('tolerates files with missing optional fields without throwing', () => {
    const data = load('drive-list.missing.json');
    const files = filesFrom(data);
    expect(files).toHaveLength(2);
    expect(files[0].id).toBe('fd-min-1');
    // renderer fallbacks keep these safe
    expect(String(files[0].name || '')).toBe('');
    expect(files[0].size ?? '—').not.toBeUndefined();
    expect(files[0].kind).toBe('drive#file');
  });

  it('survives an API envelope change (data.files / data.next_page_token)', () => {
    const data = load('drive-list.schema-drift.json');
    expect(filesFrom(data)).toHaveLength(1);
    expect(nextPageToken(data)).toBe('drift-token-0');
  });

  it('normalizes the quota payload', () => {
    const data = load('quota.ok.json');
    const quota = normalizeQuota(data);
    expect(quota).toMatchObject({ used: 8589934592, limit: 107374182400 });
    expect(quota.percent).toBeGreaterThan(0);
    expect(quota.remaining).toBe(107374182400 - 8589934592);
  });

  it('normalizes the share list', () => {
    const data = load('shares.list.json');
    const items = normalizeShareList(data.shares || data.items || []);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'pikpak#share', pass_code: '1234', share_status: 'OK' });
    expect(items[1].id).toBe('s-2002');
  });

  it('builds recent files from event fixtures, newest first', () => {
    const data = load('recent.events.json');
    const files = recentFilesFromEvents(data.events || []);
    expect(files).toHaveLength(2);
    expect(files[0].id).toBe('fd-video-1002');
    expect(files[0].kind).toBe('drive#file');
    expect(files[0].name).toBe('演示视频.mp4');
  });

  it('classifies parent-not-found responses used to recover navigation', () => {
    expect(isFileNotFound(404, {})).toBe(true);
    expect(isFileNotFound(410, {})).toBe(true);
    expect(isFileNotFound(400, { error_description: 'File or folder is not found' })).toBe(true);
    expect(isFileNotFound(400, { error: 'not_found' })).toBe(true);
    expect(isFileNotFound(400, { error_description: '目录不存在或已删除' })).toBe(true);
    expect(isFileNotFound(400, { error_description: 'Invalid request' })).toBe(false);
    expect(isFileNotFound(401, { error_description: 'Unauthorized' })).toBe(false);
    expect(isFileNotFound(429, {})).toBe(false);
    expect(isFileNotFound(500, {})).toBe(false);
    expect(apiErrorMessage(404, { error_description: 'File or folder is not found' })).toBe('文件或目录不存在，可能已被删除或移动');
  });
});
