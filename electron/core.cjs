const crypto = require('node:crypto');

const CLIENT_ID = 'YUMx5nI8ZU8Ap8pm';
const CLIENT_VERSION = 'undefined';
const PACKAGE_NAME = 'drive.mypikpak.com';
const SALTS = [
  'fyZ4+p77W1U4zcWBUwefAIFhFxvADWtT1wzolCxhg9q7etmGUjXr','uSUX02HYJ1IkyLdhINEFcCf7l2',
  'iWt97bqD/qvjIaPXB2Ja5rsBWtQtBZZmaHH2rMR41','3binT1s/5a1pu3fGsN','8YCCU+AIr7pg+yd7CkQEY16lDMwi8Rh4WNp5',
  'DYS3StqnAEKdGddRP8CJrxUSFh','crquW+4','ryKqvW9B9hly+JAymXCIfag5Z','Hr08T/NDTX1oSJfHk90c','i'
];

function parseShareUrl(value) {
  const url = new URL(value);
  if (!/(^|\.)mypikpak\.com$/i.test(url.hostname)) throw new Error('不是 PikPak 官方分享域名');
  const parts = url.pathname.split('/').filter(Boolean), index = parts.indexOf('s');
  if (index < 0 || !parts[index + 1]) throw new Error('不是有效的 PikPak 分享链接');
  return { shareId:parts[index + 1], parentToken:parts[index + 2] || '', passCode:url.searchParams.get('pass_code') || url.searchParams.get('password') || '', url:url.href };
}
function signCaptcha(deviceId, timestamp) {
  let value = CLIENT_ID + CLIENT_VERSION + PACKAGE_NAME + deviceId + timestamp;
  for (const salt of SALTS) value = crypto.createHash('md5').update(value + salt).digest('hex');
  return '1.' + value;
}
function filesFrom(data) { return data.files || data.items || data.data?.files || []; }
function nextPageToken(data) { return data.next_page_token || data.nextPageToken || data.data?.next_page_token || ''; }
function mergeShareFiles(apiFiles, scrapedFiles) {
  const scraped = new Map((scrapedFiles || []).map(item => [String(item.id), item]));
  const merged = (apiFiles || []).map(item => ({ ...scraped.get(String(item.id)), ...item, encodedToken:scraped.get(String(item.id))?.encodedToken || item.encodedToken || '' }));
  const known = new Set(merged.map(item => String(item.id)));
  for (const item of scrapedFiles || []) if (!known.has(String(item.id))) merged.push(item);
  return merged;
}
function buildShareRestorePayload({ shareId, passCodeToken='', fileIds=[], toParentId='' }) {
  const ids=Array.from(new Set((fileIds || []).map(value=>String(value || '').trim()).filter(Boolean)));
  if(!String(shareId || '').trim())throw new Error('缺少分享 ID');
  if(!ids.length)throw new Error('请选择需要保存的文件');
  const payload={share_id:String(shareId).trim(),pass_code_token:String(passCodeToken || ''),file_ids:ids,params:{trace_file_ids:ids.join(',')}};
  if(toParentId)payload.to_parent_id=String(toParentId).trim();
  return payload;
}
function buildOfflineTaskPayload(value) {
  const url=String(value || '').trim();
  if(!/^(magnet:\?|https?:\/\/|ed2k:\/\/)/i.test(url))throw new Error('请输入有效的磁力链、HTTP、HTTPS 或 ED2K 地址');
  return {kind:'drive#file',upload_type:'UPLOAD_TYPE_URL',url:{url},params:{from:'manual',with_thumbnail:'true'},folder_type:'DOWNLOAD'};
}
function normalizeQuota(data) {
  const used=Number(data?.quota?.usage), limit=Number(data?.quota?.limit);
  if(!Number.isFinite(used)||!Number.isFinite(limit)||limit<=0)return null;
  return {used,limit,remaining:Math.max(0,limit-used),percent:Math.max(0,Math.min(100,used/limit*100))};
}
function recentFilesFromEvents(events) {
  const latest=new Map();
  for(const event of Array.isArray(events)?events:[]){
    const ref=event?.reference_resource;if(!ref||typeof ref!=='object'||ref.trashed)continue;
    const id=String(event.file_id||ref.id||'');if(!id)continue;
    const folder=ref.kind==='drive#folder'||ref.mime_type==='application/x-directory';
    const time=event.event_time||event.created_time||event.create_time||event.updated_time||ref.modified_time||ref.updated_time||ref.created_time||'';
    const timestamp=Date.parse(time)||0, previous=latest.get(id);if(previous&&previous.timestamp>=timestamp)continue;
    latest.set(id,{timestamp,file:{...ref,id,kind:folder?'drive#folder':'drive#file',name:ref.name||event.file_name||event.name||id,modified_time:time||ref.modified_time||'',_recent_event_id:String(event.id||event.event_id||''),_recent_event_time:time}});
  }
  return Array.from(latest.values()).sort((a,b)=>b.timestamp-a.timestamp).map(entry=>entry.file);
}
function normalizeIds(values) {
  return Array.from(new Set((Array.isArray(values)?values:[values]).map(value=>String(value||'').trim()).filter(Boolean)));
}
function buildCreateSharePayload(fileIds,{expirationDays=7,encrypted=true}={}) {
  const ids=normalizeIds(fileIds);if(!ids.length)throw new Error('请选择需要分享的文件');
  const days=Number(expirationDays);if(!Number.isInteger(days)||(days!==-1&&days<1))throw new Error('分享有效期无效');
  return {file_ids:ids,share_to:encrypted?'encryptedlink':'publiclink',expiration_days:days,pass_code_option:encrypted?'REQUIRED':'NOT_REQUIRED'};
}
function normalizeShareList(items) {
  return (Array.isArray(items)?items:[]).map(item=>({id:String(item.share_id||item.id||''),kind:'pikpak#share',name:item.title||item.name||item.share_id||'未命名分享',size:item.file_size||0,modified_time:item.create_time||item.created_time||'',share_url:item.share_url||item.url||'',pass_code:item.pass_code||item.passCode||'',share_status:item.share_status||'OK',share_status_text:item.share_status_text||'',expiration_days:item.expiration_days,view_count:Number(item.view_count||0),save_count:Number(item.restore_count||item.save_count||0)})).filter(item=>item.id);
}
function previewKind(name,mimeType='') {
  const mime=String(mimeType).toLowerCase(),filename=String(name||'');
  if(mime.startsWith('video/')||/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp)$/i.test(filename))return 'video';
  if(mime.startsWith('audio/')||/\.(mp3|wav|flac|aac|m4a|ogg|opus|ape|wma|amr|m4b|alac|aiff|aif|mid|midi|ra|dts|ac3|dsf|dff)$/i.test(filename))return 'audio';
  if(mime.startsWith('image/')||/\.(jpg|jpeg|png|gif|webp|bmp|avif|svg)$/i.test(filename))return 'image';
  if(mime==='application/pdf'||/\.pdf$/i.test(filename))return 'pdf';
  if(mime.startsWith('text/')||/\.(txt|log|md|json|xml|srt|ass|vtt)$/i.test(filename))return 'text';
  return '';
}

function isArchiveFile(name,mimeType='') {
  const mime=String(mimeType).toLowerCase(),filename=String(name||'');
  return mime.includes('zip')||mime.includes('rar')||mime.includes('7z')||mime.includes('compressed')||mime.includes('archive')||/\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(filename);
}
function archiveItemsFrom(data) {
  const source=Array.isArray(data?.files)?data.files:Array.isArray(data?.list)?data.list:[];
  return source.map((item,index)=>{
    const name=String(item.filename||item.file_name||item.name||`项目 ${index+1}`);
    const size=Number(item.filesize||item.size||0);
    const folder=item.kind==='drive#folder'||(!size&&!item.mime_type);
    return {index:item.index??index,name,size,kind:folder?'drive#folder':'drive#file',mime_type:item.mime_type||'',path:item.path||'',icon_link:item.icon_link||''};
  });
}
function archiveAccessToken(detail) {
  for(const entry of Array.isArray(detail?.apps)?detail.apps:[]){
    const link=String(entry?.link||'');if(!link.includes('access_token='))continue;
    try{const value=new URL(link).searchParams.get('access_token');if(value)return value}catch{}
    const match=link.match(/[?&]access_token=([^&#]+)/);if(match)return decodeURIComponent(match[1]);
  }
  return '';
}

function sanitizeSubDir(subDir) {
  if (!subDir) return '';
  return String(subDir)
    .split(/[\\/]/)
    .map(part => part.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/_+/g, '_').replace(/^[. _]+|[. _]+$/g, ''))
    .filter(part => part && part !== '.' && part !== '..')
    .slice(0, 50)
    .join('/');
}

function matchSubtitles(videoName, fileList) {
  if (!videoName || !Array.isArray(fileList)) return [];
  const baseName = String(videoName).replace(/\.[^/.]+$/, '').trim().toLowerCase();
  const subFiles = fileList.filter(f => {
    const name = String(f?.name || '');
    return /\.(srt|vtt|ass)$/i.test(name) && f?.kind !== 'drive#folder';
  });
  if (!subFiles.length) return [];
  const scored = subFiles.map(file => {
    const subBase = String(file.name).replace(/\.[^/.]+$/, '').trim().toLowerCase();
    let score = 0;
    if (subBase === baseName) score = 100;
    else if (subBase.startsWith(baseName)) score = 80;
    else if (baseName.startsWith(subBase)) score = 70;
    else {
      const videoTokens = new Set(baseName.split(/[._\-\s]+/).filter(t => t.length > 1));
      const subTokens = subBase.split(/[._\-\s]+/).filter(t => t.length > 1);
      const overlap = subTokens.filter(t => videoTokens.has(t)).length;
      if (overlap > 0) score = Math.min(60, overlap * 20);
      else score = 10;
    }
    return { file, score };
  });
  return scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.file);
}

function detectConflicts(sources, targets) {
  const targetMap = new Map();
  for (const t of targets || []) {
    if (t?.name) targetMap.set(String(t.name).trim().toLowerCase(), t);
  }
  const conflicts = [];
  const nonConflicts = [];
  for (const s of sources || []) {
    const key = String(s?.name || '').trim().toLowerCase();
    if (key && targetMap.has(key)) {
      conflicts.push({ source: s, existing: targetMap.get(key) });
    } else if (s) {
      nonConflicts.push(s);
    }
  }
  return { conflicts, nonConflicts };
}

function generateUniqueName(name, existingNames) {
  const existingSet = new Set((existingNames || []).map(n => String(n).trim().toLowerCase()));
  const trimmed = String(name || '未命名').trim();
  if (!existingSet.has(trimmed.toLowerCase())) return trimmed;

  const dotIdx = trimmed.lastIndexOf('.');
  const hasExt = dotIdx > 0 && dotIdx < trimmed.length - 1;
  const base = hasExt ? trimmed.slice(0, dotIdx) : trimmed;
  const ext = hasExt ? trimmed.slice(dotIdx) : '';

  let candidate = `${base} - 副本${ext}`;
  let count = 2;
  while (existingSet.has(candidate.toLowerCase())) {
    candidate = `${base} - 副本 (${count})${ext}`;
    count++;
  }
  return candidate;
}

function buildInterruptedDownloadOptions(params) {
  if (!params || typeof params !== 'object') return null;
  const { task, localSize = 0 } = params;
  if (!task || typeof task !== 'object') return null;
  const filePath = String(task.path || '').trim();
  if (!filePath) return null;

  const total = Number(task.total || 0);
  const offset = Number(localSize);

  if (!Number.isFinite(offset) || offset <= 0 || (total > 0 && offset >= total)) {
    return null;
  }

  const urlChain = Array.isArray(task.urlChain) && task.urlChain.length
    ? task.urlChain.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u))
    : (task.url && /^https?:\/\//i.test(task.url) ? [task.url] : []);

  if (!urlChain.length) return null;

  return {
    path: filePath,
    urlChain,
    offset,
    length: total > offset ? total : 0,
    lastModified: String(task.lastModified || ''),
    eTag: String(task.eTag || ''),
    startTime: Number(task.startTime) || Math.floor(Date.now() / 1000)
  };
}

module.exports = { CLIENT_ID, CLIENT_VERSION, PACKAGE_NAME, parseShareUrl, signCaptcha, filesFrom, nextPageToken, mergeShareFiles, buildShareRestorePayload, buildOfflineTaskPayload, normalizeQuota, recentFilesFromEvents, normalizeIds, buildCreateSharePayload, normalizeShareList, previewKind, isArchiveFile, archiveItemsFrom, archiveAccessToken, sanitizeSubDir, matchSubtitles, detectConflicts, generateUniqueName, buildInterruptedDownloadOptions };
