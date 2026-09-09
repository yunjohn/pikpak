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
function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}
function searchNameMatches(name, normalizedQuery) {
  return normalizeSearchText(name).includes(normalizeSearchText(normalizedQuery));
}
function isDriveFolder(item = {}) {
  return item.kind === 'drive#folder' || item.mime_type === 'application/x-directory';
}
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
function buildOfflineTaskPayload(value,parentId='') {
  const url=String(value || '').trim();
  if(!/^(magnet:\?|https?:\/\/|ed2k:\/\/)/i.test(url))throw new Error('请输入有效的磁力链、HTTP、HTTPS 或 ED2K 地址');
  const payload={kind:'drive#file',upload_type:'UPLOAD_TYPE_URL',url:{url},params:{from:'manual',with_thumbnail:'true'}};
  const target=String(parentId||'').trim();if(target)payload.parent_id=target;else payload.folder_type='DOWNLOAD';
  return payload;
}

// Extracts a usable magnet link from arbitrary clipboard text (or null).
function findMagnetLink(text) {
  const source = String(text || '');
  const match = source.match(/magnet:\?[^\s<>"']+/i);
  if (!match) return null;
  const uri = match[0].replace(/[\]\[(){}（）【】《》，。；;！!？?、]+$/u, '');
  return /[?&]xt=urn:[A-Za-z0-9]+:[A-Za-z0-9]+/i.test(uri) ? uri : null;
}

function magnetIdentity(uri) {
  const magnet = findMagnetLink(uri);
  if (!magnet) return '';
  try {
    const xt = new URL(magnet).searchParams.getAll('xt').find(value => /^urn:[A-Za-z0-9]+:[A-Za-z0-9]+$/i.test(value));
    return xt ? xt.toLowerCase() : '';
  } catch { return ''; }
}

function decodeHtmlText(value) {
  return String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|#38);/gi,'&').replace(/&(?:quot|#34);/gi,'"').replace(/&(?:apos|#39);/gi,"'").replace(/&(?:lt|#60);/gi,'<').replace(/&(?:gt|#62);/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
}
function parseExternalSearchHtml(html) {
  const source=String(html||''),results=[],seen=new Set(),magnetPattern=/magnet:\?[^\s<>"']+/ig;
  const rows=[...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/ig)].map(value=>value[1]);
  for(const row of rows){
    const rawMagnet=row.match(magnetPattern)?.[0],magnet=findMagnetLink(String(rawMagnet||'').replace(/&amp;/gi,'&').replace(/&#38;/g,'&')),key=magnetIdentity(magnet);if(!magnet||!key||seen.has(key))continue;
    const links=[...row.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/ig)].map(value=>{const attrs=value[1],href=attrs.match(/\bhref=["']([^"']*)["']/i)?.[1]||'',title=attrs.match(/\btitle=["']([^"']*)["']/i)?.[1]||'';return {href,title:decodeHtmlText(title||value[2])}});
    const titleLink=links.find(link=>/\/view\//i.test(link.href))||links.find(link=>link.title&&!/^magnet:/i.test(link.href)&&!/\.torrent(?:[?#]|$)/i.test(link.href));
    seen.add(key);results.push({title:titleLink?.title||`磁力资源 ${results.length+1}`,magnet,key});
  }
  if(results.length)return results;
  for(const match of source.matchAll(magnetPattern)){
    const magnet=findMagnetLink(match[0].replace(/&amp;/gi,'&').replace(/&#38;/g,'&')),key=magnetIdentity(magnet);if(!magnet||!key||seen.has(key))continue;
    const near=source.slice(Math.max(0,match.index-2000),match.index);
    const candidates=[...near.matchAll(/<(?:h[1-6]|a|strong|b)[^>]*(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/(?:h[1-6]|a|strong|b)>/ig)].map(value=>decodeHtmlText(value[1]||value[2])).filter(value=>value&&!/^magnet:/i.test(value)&&!/^(?:下载|磁力|复制|详情|立即下载)$/i.test(value));
    seen.add(key);results.push({title:candidates.at(-1)||`磁力资源 ${results.length+1}`,magnet,key});
  }
  return results;
}

// Central, testable model for an offline download task's status.
// `phase` values come from PikPak (e.g. PHASE_TYPE_RUNNING / COMPLETE / ERROR /
// PAUSED / PENDING); we classify by substring so minor value changes don't break the UI.
function offlineTaskState(task = {}) {
  const phase = String(task?.phase || '').toUpperCase();
  const raw = Number(task?.progress ?? task?.progress_percent ?? 0);
  const percent = Math.max(0, Math.min(100, Math.round(raw > 0 && raw <= 1 ? raw * 100 : raw)));
  let state, label;
  if (phase.includes('COMPLETE')) { state = 'completed'; label = '已完成'; }
  else if (phase.includes('ERROR') || phase.includes('FAILED')) { state = 'failed'; label = '失败'; }
  else if (phase.includes('PAUSED')) { state = 'paused'; label = '已暂停'; }
  else if (phase.includes('RUNNING')) { state = 'running'; label = '下载中'; }
  else { state = 'waiting'; label = '等待中'; }
  return {
    state, label, percent,
    isTerminal: state === 'completed' || state === 'failed',
    // A failed task can be retried by re-submitting its source URL (create endpoint).
    canRetry: state === 'failed'
  };
}

// Builds the request descriptor for an offline task action. The only action verified
// against the real API is `delete`. The open-source PikPak clients (rclone, AList,
// pikpak-js-sdk) expose create/list/delete for offline tasks but no pause / resume /
// retry control endpoint; do not guess it. Once a real-account capture of the official
// client confirms how it pauses/resumes/retries, add that here in one place.
function buildOfflineTaskAction(action, id) {
  const taskId = String(id || '').trim();
  if (!taskId) throw new Error('缺少离线任务 ID');
  const value = String(action || '').toLowerCase();
  if (value === 'delete') {
    return { method: 'DELETE', path: '/drive/v1/tasks', query: { task_ids: taskId, delete_files: 'false' }, body: undefined };
  }
  throw new Error(`离线任务操作「${value}」暂未实现：需先在真实账号下核对 PikPak 对应接口`);
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
function normalizeRemoteName(value) {
  const name=String(value || '').trim();
  if(!name)throw new Error('名称不能为空');
  if(name==='.'||name==='..'||/[\/\\\x00-\x1f]/.test(name))throw new Error('名称不能包含路径分隔符或控制字符');
  if([...name].length>255)throw new Error('名称不能超过 255 个字符');
  return name;
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

function normalizeDownloadRefreshId(value) {
  const id=String(value || '').trim();
  return id.length<=512&&!/[\x00-\x1f]/.test(id)&&/^(?:drive:[^:]+|share:[^:]+:.+)$/.test(id) ? id : '';
}
function verifiedDownloadState(state,{total=0,received=0,diskSize=0}={}) {
  const normalized=String(state || '');
  if(normalized!=='completed')return {state:normalized,error:normalized==='interrupted'?'下载中断':''};
  const expected=Number(total),networkBytes=Number(received),savedBytes=Number(diskSize);
  if(expected>0&&(networkBytes!==expected||savedBytes!==expected))return {state:'failed',error:'下载文件大小校验失败，请重试'};
  if(networkBytes>0&&savedBytes!==networkBytes)return {state:'failed',error:'下载文件落盘不完整，请重试'};
  return {state:'completed',error:''};
}

function isValidDeviceId(value) {
  return /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || ''));
}

function accountForStorage(account = {}, previous = {}, fallbackDeviceId = '', now = Date.now()) {
  const candidate = account.deviceId || previous.deviceId || fallbackDeviceId;
  return {
    accessToken: String(account.accessToken || ''),
    refreshToken: String(account.refreshToken || previous.refreshToken || ''),
    clientId: String(account.clientId || previous.clientId || ''),
    tokenExpiresAt: Math.max(0, Number(account.tokenExpiresAt || previous.tokenExpiresAt) || 0),
    deviceId: isValidDeviceId(candidate) ? String(candidate) : '',
    source: account.source || previous.source || '',
    updatedAt: account.updatedAt || now
  };
}

function extractCredentialsFromStorage(entries = {}) {
  const findCredentials = (value, depth = 0, seen = new Set(), parentKey = '') => {
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return null;
    seen.add(value);
    const tokenContainer = /tokens?|credentials?|session/i.test(parentKey);
    const refreshToken = String(value.refresh_token || value.refreshToken || (tokenContainer ? value.refresh : '') || '');
    const accessToken = String(value.access_token || value.accessToken || (tokenContainer ? value.access : '') || '');
    if (refreshToken || accessToken) {
      return { refreshToken, accessToken, clientId: String(value.client_id || value.clientId || '') };
    }
    for (const [key, nested] of Object.entries(value)) {
      if (nested && typeof nested === 'object') {
        const found = findCredentials(nested, depth + 1, seen, key);
        if (found) return found;
      }
    }
    return null;
  };
  for (const [key, raw] of Object.entries(entries || {})) {
    if (typeof raw !== 'string' || raw.length < 20 || raw.length > 100000) continue;
    if (!/token/i.test(key) && !/(?:refresh|access)_?token/i.test(raw) && !/"(?:tokens?|credentials?)"\s*:/i.test(raw)) continue;
    let value = raw;
    try {
      value = JSON.parse(raw);
      if (typeof value === 'string') value = JSON.parse(value);
    } catch { continue }
    const found = findCredentials(value);
    if (!found) continue;
    return {
      ...found,
      storageKey: String(key)
    };
  }
  return null;
}

function buildTokenRefreshBody({ refreshToken, clientId = '' } = {}) {
  const token = String(refreshToken || '').trim();
  if (!token) throw new Error('缺少 refresh_token，无法刷新登录状态');
  const resolvedClientId = String(clientId || CLIENT_ID).trim();
  if (!resolvedClientId) throw new Error('缺少 client_id，无法刷新登录状态');
  return { client_id: resolvedClientId, grant_type: 'refresh_token', refresh_token: token, client_secret: '' };
}
function normalizeAccessToken(value) {
  const token=String(value || '').trim().replace(/^Bearer\s+/i,'').trim();
  if(token.length<20||token.length>10000||/\s/.test(token))throw new Error('Access Token 格式无效');
  return token;
}

function jwtExpiryMs(token) {
  try {
    const parts=String(token||'').split('.');
    if(parts.length!==3)return 0;
    const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    const seconds=Number(payload?.exp||0);
    return Number.isFinite(seconds)&&seconds>0?Math.floor(seconds*1000):0;
  } catch { return 0 }
}

function tokenRefreshDelayMs(expiresAt, now = Date.now(), earlyMs = 5 * 60 * 1000) {
  const expiry = Number(expiresAt);
  const current = Number(now);
  const margin = Math.max(0, Number(earlyMs) || 0);
  if (!Number.isFinite(expiry) || expiry <= 0 || !Number.isFinite(current)) return null;
  return Math.max(0, expiry - current - margin);
}

function isFileNotFound(status, data = {}) {
  const code = Number(status) || 0;
  if (code === 404 || code === 410) return true;
  const detail = String(data?.error_description || data?.error || data?.message || '').toLowerCase();
  return /not[ _-]?found|does n?ot exist|no such [a-z ]*|不存在|未找到|已不存在/.test(detail);
}

function apiErrorMessage(status, data = {}) {
  const code=Number(status)||0;
  if(code===429)return '请求过于频繁，请稍后重试';
  if(code>=500)return 'PikPak 服务暂时不可用，请稍后重试';
  if(isFileNotFound(status,data))return '文件或目录不存在，可能已被删除或移动';
  const detail=String(data?.error_description||data?.error||data?.message||'').trim();
  if(detail)return detail.slice(0,300);
  return code?`请求失败 (${code})`:'网络连接失败，请检查网络后重试';
}

function compareVersions(a, b) {
  const parse = value => String(value || '0').trim().replace(/^v/i, '').split('.').map(part => {
    const match = String(part).match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  });
  const pa = parse(a), pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function isUpdateAvailable(localVersion, remoteVersion) {
  return compareVersions(remoteVersion, localVersion) > 0;
}

function decodeSubtitleBytes(input) {
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input || []);
  if(bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff){const swapped=Buffer.allocUnsafe(bytes.length-2);for(let i=2;i+1<bytes.length;i+=2){swapped[i-2]=bytes[i+1];swapped[i-1]=bytes[i]}return new TextDecoder('utf-16le').decode(swapped)}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return new TextDecoder('gb18030').decode(bytes)}
}

function playbackSourcesFromFile(file = {}) {
  const rank=value=>{const text=String(value||'').toUpperCase();return text.includes('1080')||text==='FHD'?1080:text.includes('720')||text==='HD'?720:text.includes('480')||text==='SD'?480:0};
  const toUrl=media=>{let url=String(media?.link?.url||'');const type=String(media?.video?.video_type||media?.video_type||'').toLowerCase();if(type==='mpegts'&&!url.includes('ts_downloader'))url=`https://web-vod-xdrive.mypikpak.com/ts_downloader?client_id=${CLIENT_ID}&url=${encodeURIComponent(url.replace(/[?&]ext=\.m3u8(?=&|$)/,'').replace(/[?&]$/,''))}`;return url};
  const label=media=>{const text=String(media?.resolution_name||media?.video_stream_id||'').toUpperCase();return rank(text)?`${rank(text)}P`:(media?.is_origin?'原画':'转码')};
  const medias=Array.isArray(file.medias)?file.medias:[];
  const values=[...medias.filter(media=>!media?.is_origin&&media?.link?.url).sort((a,b)=>rank(b.resolution_name||b.video_stream_id)-rank(a.resolution_name||a.video_stream_id)).map(media=>({url:toUrl(media),label:label(media)})),...medias.filter(media=>media?.is_origin&&media?.link?.url).map(media=>({url:toUrl(media),label:'原画'})),...(file.web_content_link?[{url:String(file.web_content_link),label:'原始文件'}]:[])];
  const seen=new Set();return values.filter(source=>/^https?:\/\//i.test(source.url)&&!seen.has(source.url)&&seen.add(source.url));
}

module.exports = { CLIENT_ID, CLIENT_VERSION, PACKAGE_NAME, parseShareUrl, signCaptcha, filesFrom, nextPageToken, normalizeSearchText, searchNameMatches, isDriveFolder, mergeShareFiles, buildShareRestorePayload, buildOfflineTaskPayload, buildOfflineTaskAction, offlineTaskState, findMagnetLink, magnetIdentity, parseExternalSearchHtml, normalizeQuota, recentFilesFromEvents, normalizeIds, normalizeRemoteName, buildCreateSharePayload, normalizeShareList, previewKind, isArchiveFile, archiveItemsFrom, archiveAccessToken, sanitizeSubDir, matchSubtitles, detectConflicts, generateUniqueName, buildInterruptedDownloadOptions, normalizeDownloadRefreshId, verifiedDownloadState, isValidDeviceId, accountForStorage, extractCredentialsFromStorage, buildTokenRefreshBody, normalizeAccessToken, jwtExpiryMs, tokenRefreshDelayMs, apiErrorMessage, isFileNotFound, compareVersions, isUpdateAvailable, decodeSubtitleBytes, playbackSourcesFromFile };
