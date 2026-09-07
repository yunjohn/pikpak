import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseShareUrl, signCaptcha, filesFrom, nextPageToken, mergeShareFiles, buildShareRestorePayload, buildOfflineTaskPayload, normalizeQuota, recentFilesFromEvents, normalizeIds, buildCreateSharePayload, normalizeShareList, previewKind, isArchiveFile, archiveItemsFrom, archiveAccessToken, matchSubtitles, detectConflicts, generateUniqueName } = require('../electron/core.cjs');

describe('desktop core', () => {
  it('detects name conflicts case-insensitively and separates non-conflicts', () => {
    const sources = [
      { id: '1', name: 'File.txt' },
      { id: '2', name: 'unique.mp4' },
      { id: '3', name: 'Folder' }
    ];
    const targets = [
      { id: 't1', name: 'file.TXT' },
      { id: 't2', name: 'other.pdf' },
      { id: 't3', name: 'folder' }
    ];
    const { conflicts, nonConflicts } = detectConflicts(sources, targets);
    expect(conflicts.map(c => c.source.name)).toEqual(['File.txt', 'Folder']);
    expect(conflicts.map(c => c.existing.id)).toEqual(['t1', 't3']);
    expect(nonConflicts.map(n => n.name)).toEqual(['unique.mp4']);
  });

  it('generates unique copy names avoiding existing collisions', () => {
    expect(generateUniqueName('doc.pdf', ['file.txt'])).toBe('doc.pdf');
    expect(generateUniqueName('doc.pdf', ['doc.pdf'])).toBe('doc - 副本.pdf');
    expect(generateUniqueName('doc.pdf', ['doc.pdf', 'doc - 副本.pdf'])).toBe('doc - 副本 (2).pdf');
    expect(generateUniqueName('MyFolder', ['MyFolder'])).toBe('MyFolder - 副本');
  });
  it('parses a PikPak share id and opaque directory token', () => {
    expect(parseShareUrl('https://mypikpak.com/s/share-id/folder-token')).toMatchObject({shareId:'share-id',parentToken:'folder-token'});
    expect(parseShareUrl('https://mypikpak.com/s/share-id?pass_code=1234')).toMatchObject({passCode:'1234'});
  });
  it('rejects lookalike and non-share URLs', () => {
    expect(() => parseShareUrl('https://mypikpak.com.evil.test/s/a/b')).toThrow();
    expect(() => parseShareUrl('https://mypikpak.com/drive/all')).toThrow();
  });
  it('creates a deterministic versioned captcha signature', () => {
    const value=signCaptcha('0123456789abcdef0123456789abcdef','1787884938467');
    expect(value).toMatch(/^1\.[0-9a-f]{32}$/);
    expect(value).toBe(signCaptcha('0123456789abcdef0123456789abcdef','1787884938467'));
  });
  it('normalizes supported API list envelopes', () => {
    expect(filesFrom({files:[1]})).toEqual([1]);
    expect(filesFrom({data:{files:[2]}})).toEqual([2]);
    expect(filesFrom({})).toEqual([]);
    expect(nextPageToken({next_page_token:'next'})).toBe('next');
    expect(nextPageToken({data:{next_page_token:'nested'}})).toBe('nested');
  });
  it('merges opaque folder tokens scraped from the official share page', () => {
    const api=[{id:'folder',name:'API name',kind:'drive#folder',size:'0'}];
    const scraped=[{id:'folder',name:'DOM name',kind:'drive#folder',encodedToken:'opaque-token'},{id:'late',name:'Late row',kind:'drive#file'}];
    expect(mergeShareFiles(api,scraped)).toEqual([
      {id:'folder',name:'API name',kind:'drive#folder',size:'0',encodedToken:'opaque-token'},
      {id:'late',name:'Late row',kind:'drive#file'}
    ]);
  });

  it('builds the official share restore payload and removes duplicate ids', () => {
    expect(buildShareRestorePayload({shareId:'share-1',passCodeToken:'token',fileIds:['a','a','b']})).toEqual({
      share_id:'share-1',pass_code_token:'token',file_ids:['a','b'],params:{trace_file_ids:'a,b'}
    });
    expect(buildShareRestorePayload({shareId:'share-1',fileIds:['a'],toParentId:'folder-123'})).toMatchObject({
      to_parent_id:'folder-123'
    });
  });

  it('matches subtitles in the same folder by name similarity and ranks them', () => {
    const list = [
      { id: 'sub1', name: 'Movie.2024.chs.srt' },
      { id: 'sub2', name: 'Movie.2024.mkv' },
      { id: 'sub3', name: 'Other.Show.S01E01.vtt' },
      { id: 'sub4', name: 'Movie.2024.ass' },
      { id: 'folder', name: 'Subtitles', kind: 'drive#folder' }
    ];
    const matched = matchSubtitles('Movie.2024.mkv', list);
    expect(matched.map(f => f.id)).toEqual(['sub4', 'sub1', 'sub3']);
    expect(matchSubtitles('Unrelated.mp4', [])).toEqual([]);
  });

  it('builds an official URL-upload task and rejects unsupported input', () => {
    expect(buildOfflineTaskPayload(' magnet:?xt=urn:btih:abc ')).toMatchObject({upload_type:'UPLOAD_TYPE_URL',url:{url:'magnet:?xt=urn:btih:abc'},folder_type:'DOWNLOAD'});
    expect(buildOfflineTaskPayload('https://example.test/file','folder-1')).toMatchObject({upload_type:'UPLOAD_TYPE_URL',parent_id:'folder-1'});
    expect(buildOfflineTaskPayload('https://example.test/file','folder-1')).not.toHaveProperty('folder_type');
    expect(() => buildOfflineTaskPayload('not a link')).toThrow('有效');
  });

  it('normalizes account storage quota and clamps remaining values', () => {
    expect(normalizeQuota({quota:{usage:'25',limit:'100'}})).toEqual({used:25,limit:100,remaining:75,percent:25});
    expect(normalizeQuota({quota:{usage:'120',limit:'100'}})).toMatchObject({remaining:0,percent:100});
    expect(normalizeQuota({quota:{usage:'0',limit:'0'}})).toBeNull();
  });

  it('maps recent events to unique newest non-trashed files', () => {
    const files=recentFilesFromEvents([
      {id:'old',file_id:'a',event_time:'2026-01-01T00:00:00Z',reference_resource:{id:'a',name:'旧名称',kind:'drive#file'}},
      {id:'new',file_id:'a',event_time:'2026-02-01T00:00:00Z',reference_resource:{id:'a',name:'新名称',kind:'drive#file'}},
      {id:'gone',file_id:'b',event_time:'2026-03-01T00:00:00Z',reference_resource:{id:'b',name:'回收站',kind:'drive#file',trashed:true}}
    ]);
    expect(files).toHaveLength(1);expect(files[0]).toMatchObject({id:'a',name:'新名称',_recent_event_id:'new'});
  });

  it('normalizes and deduplicates batch mutation ids', () => {
    expect(normalizeIds([' a ','','a','b',null])).toEqual(['a','b']);
    expect(normalizeIds('single')).toEqual(['single']);
  });

  it('builds a protected seven-day share payload', () => {
    expect(buildCreateSharePayload(['a','a','b'])).toEqual({file_ids:['a','b'],share_to:'encryptedlink',expiration_days:7,pass_code_option:'REQUIRED'});
    expect(() => buildCreateSharePayload([])).toThrow('选择');
  });

  it('normalizes the official share list envelope items', () => {
    expect(normalizeShareList([{share_id:'s1',title:'资料',share_url:'https://mypikpak.com/s/s1',pass_code:'7788',restore_count:'2'}])[0]).toMatchObject({id:'s1',kind:'pikpak#share',name:'资料',pass_code:'7788',save_count:2});
  });

  it('allows native preview types and rejects download-only files', () => {
    expect(previewKind('movie.mp4')).toBe('video');expect(previewKind('legacy.avi')).toBe('video');expect(previewKind('music.opus')).toBe('audio');expect(previewKind('cover.avif')).toBe('image');expect(previewKind('document','application/pdf')).toBe('pdf');expect(previewKind('notes.txt')).toBe('text');expect(previewKind('archive.zip')).toBe('');expect(previewKind('setup.exe')).toBe('');
  });
  it('recognizes archives and normalizes their read-only directory listing',()=>{
    expect(isArchiveFile('backup.7z')).toBe(true);expect(isArchiveFile('setup.exe')).toBe(false);
    expect(archiveItemsFrom({files:[{filename:'folder',filesize:0},{filename:'a.txt',filesize:'12',mime_type:'text/plain'}]})).toMatchObject([{name:'folder',kind:'drive#folder'},{name:'a.txt',kind:'drive#file',size:12}]);
    expect(archiveAccessToken({apps:[{link:'https://example.test/view?access_token=abc%20123'}]})).toBe('abc 123');
  });
});
