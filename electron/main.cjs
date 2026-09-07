const { app, BrowserWindow, clipboard, dialog, ipcMain, powerSaveBlocker, safeStorage, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { CLIENT_ID, CLIENT_VERSION, PACKAGE_NAME, parseShareUrl, signCaptcha, filesFrom, nextPageToken, mergeShareFiles, buildShareRestorePayload, buildOfflineTaskPayload, normalizeQuota, recentFilesFromEvents, normalizeIds, buildCreateSharePayload, normalizeShareList, previewKind, archiveItemsFrom, archiveAccessToken, sanitizeSubDir, buildInterruptedDownloadOptions, isValidDeviceId, accountForStorage, decodeSubtitleBytes, playbackSourcesFromFile } = require('./core.cjs');
const { logger } = require('./logger.cjs');

process.on('uncaughtException', err => logger.error('process', 'Uncaught exception', err?.stack || err));
process.on('unhandledRejection', reason => logger.error('process', 'Unhandled rejection', reason?.stack || reason));

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production' && !process.env.PIKPAK_PROD;

let deviceId = crypto.randomBytes(16).toString('hex');
let captcha = { token: '', expiresAt: 0, action: '' };
let loginWindow = null;
let loginCompletion = null;
let authRefreshWindow = null;
let authRefreshPromise = null;
const authRefreshWaiters = new Set();
let shareBridgeWindow = null;
let mainWindow = null;
const viewerWindows = new Set();
const viewerPayloads = new Map();
const playingViewers = new Set();
let playbackPowerBlocker = null;
let viewerDownloadsBlocked = false;
const downloadItems = new Map();
const pendingDownloads = [];
const downloadQueue = [];
let activeDownloads = 0;
const uploadControllers = new Map();
const uploadQueue = [];
let activeUploads = 0;
let downloadHistory = [];
let downloadSaveTimer = null;
let uploadHistory = [];
let uploadSaveTimer = null;
let playbackHistory = {};
let playbackSaveTimer = null;
let settings = { downloadDirectory:'', downloadConcurrency:3, uploadConcurrency:3 };

function updatePlaybackPowerBlocker(){
  if(playingViewers.size&&playbackPowerBlocker===null)playbackPowerBlocker=powerSaveBlocker.start('prevent-display-sleep');
  else if(!playingViewers.size&&playbackPowerBlocker!==null){if(powerSaveBlocker.isStarted(playbackPowerBlocker))powerSaveBlocker.stop(playbackPowerBlocker);playbackPowerBlocker=null}
}

function configPath() { return path.join(app.getPath('userData'), 'account.bin'); }
function readAccount() {
  try {
    const raw = fs.readFileSync(configPath());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(text);
  } catch { return { accessToken: '' }; }
}
function writeAccount(account) {
  const previous=readAccount();
  const text = JSON.stringify(accountForStorage(account,previous,deviceId));
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), data);
}
function clearAccount() { try { fs.unlinkSync(configPath()); } catch {} }
function restoreDeviceId(){const saved=String(readAccount().deviceId||'');if(isValidDeviceId(saved))deviceId=saved}
function rotateDeviceId(){deviceId=crypto.randomBytes(16).toString('hex');captcha={token:'',expiresAt:0,action:''}}
async function getCaptcha(action) {
  if (captcha.token && captcha.action === action && Date.now() < captcha.expiresAt) return captcha.token;
  const timestamp = String(Date.now());
  const response = await fetch('https://user.mypikpak.com/v1/shield/captcha/init', {
    method: 'POST', headers: { 'content-type':'application/json', 'x-client-id':CLIENT_ID, 'x-device-id':deviceId },
    body: JSON.stringify({ client_id:CLIENT_ID, action, device_id:deviceId, meta:{ captcha_sign:signCaptcha(deviceId,timestamp), client_version:CLIENT_VERSION, package_name:PACKAGE_NAME, user_id:'', timestamp } })
  });
  const data = await response.json();
  if (!response.ok || !data.captcha_token) throw new Error(data.error_description || data.error || '获取访问令牌失败');
  captcha = { token:data.captcha_token, action, expiresAt:Date.now() + (Number(data.expires_in || 300)-10)*1000 };
  return captcha.token;
}
async function apiRequest(url, { action, method='GET', body, authorization='', retryAuth=true } = {}) {
  const token = await getCaptcha(action || `${method}:${new URL(url).pathname}`);
  const headers = { 'x-client-id':CLIENT_ID, 'x-device-id':deviceId, 'x-captcha-token':token };
  if (body) headers['content-type'] = 'application/json';
  if (authorization) headers.authorization = authorization.startsWith('Bearer ') ? authorization : `Bearer ${authorization}`;
  const response = await fetch(url, { method, headers, body:body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.warn('api', `API request failed (${response.status})`, { path: new URL(url).pathname, status: response.status, error: data.error_description || data.error });
    if(authorization&&retryAuth&&(response.status===401||response.status===403)){
      logger.info('auth', 'Attempting auth refresh for expired credentials');
      const refreshed=await refreshOfficialAuth();
      if(refreshed){const next=readAccount().accessToken;return apiRequest(url,{action,method,body,authorization:next,retryAuth:false})}
      clearAccount();if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('account:expired');
      logger.warn('auth', 'Auth refresh failed, session expired');
      throw new Error('登录状态已过期，请重新登录 PikPak');
    }
    const error=new Error(data.error_description || data.error || `请求失败 (${response.status})`);error.status=response.status;error.data=data;throw error;
  }
  return data;
}
async function listPages(makeUrl, options) {
  const files=[]; let pageToken=''; let raw={};
  for(let page=0;page<100;page++){
    raw=await apiRequest(makeUrl(pageToken),options);
    files.push(...filesFrom(raw)); pageToken=nextPageToken(raw);
    if(!pageToken)break;
  }
  return {files,raw};
}
async function driveMutation(pathname,{method='POST',body}={}){
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  return apiRequest(`https://api-drive.mypikpak.com${pathname}`,{action:`${method}:${pathname}`,method,body,authorization:account.accessToken});
}
function accountStatus() { const value=readAccount(); return { connected:!!value.accessToken, source:value.source || '', updatedAt:value.updatedAt || 0 }; }
function installPikPakSessionCapture() {
  const pikpakSession=session.fromPartition('persist:pikpak-login');
  pikpakSession.webRequest.onBeforeSendHeaders({urls:['https://*.mypikpak.com/*']},(details,callback)=>{
    const headers=details.requestHeaders || {};
    const find=name=>{const key=Object.keys(headers).find(item=>item.toLowerCase()===name);return key?String(headers[key]||''):''};
    const auth=find('authorization'), capturedDevice=find('x-device-id'), capturedCaptcha=find('x-captcha-token');
    if(capturedDevice)deviceId=capturedDevice;
    if(capturedCaptcha)captcha={token:capturedCaptcha,action:'',expiresAt:Date.now()+240000};
    if(auth.length>20){
      const accessToken=auth.replace(/^Bearer\s+/i,'');writeAccount({accessToken,source:'web-login',updatedAt:Date.now()});
      for(const waiter of authRefreshWaiters)if(accessToken!==waiter.previous){authRefreshWaiters.delete(waiter);waiter.resolve(true)}
      if(loginCompletion){const done=loginCompletion;loginCompletion=null;done(accountStatus());setTimeout(()=>{if(loginWindow&&!loginWindow.isDestroyed())loginWindow.close()},500)}
    }
    callback({requestHeaders:headers});
  });
}
function refreshOfficialAuth(){
  if(authRefreshPromise)return authRefreshPromise;
  const previous=readAccount().accessToken;
  authRefreshPromise=new Promise(resolve=>{
    let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);authRefreshWaiters.delete(waiter);if(authRefreshWindow&&!authRefreshWindow.isDestroyed())authRefreshWindow.close();authRefreshWindow=null;resolve(value)};
    const waiter={previous,resolve:()=>finish(true)};authRefreshWaiters.add(waiter);const timer=setTimeout(()=>finish(false),18000);
    authRefreshWindow=new BrowserWindow({show:false,width:900,height:650,webPreferences:{session:session.fromPartition('persist:pikpak-login'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    authRefreshWindow.on('closed',()=>{authRefreshWindow=null});
    authRefreshWindow.loadURL('https://mypikpak.com/drive/all').catch(()=>finish(false));
  }).finally(()=>{authRefreshPromise=null});
  return authRefreshPromise;
}
function openLoginWindow(){
  if(loginWindow&&!loginWindow.isDestroyed()){loginWindow.focus();return}
  loginWindow=new BrowserWindow({width:1080,height:760,minWidth:760,minHeight:560,title:'登录 PikPak',autoHideMenuBar:true,webPreferences:{session:session.fromPartition('persist:pikpak-login'),contextIsolation:true,nodeIntegration:false}});
  loginWindow.loadURL('https://mypikpak.com/drive/all');
  loginWindow.on('closed',()=>{loginWindow=null;if(loginCompletion){const done=loginCompletion;loginCompletion=null;done(accountStatus())}});
}

function safeFilename(value) {
  const name=String(value || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,180);
  return name || 'download';
}
function settingsPath(){return path.join(app.getPath('userData'),'settings.json')}
function normalizeSettings(value={}){const directory=String(value.downloadDirectory||'');return {downloadDirectory:directory&&fs.existsSync(directory)?directory:'',downloadConcurrency:Math.max(1,Math.min(8,Math.round(Number(value.downloadConcurrency)||3))),uploadConcurrency:Math.max(1,Math.min(8,Math.round(Number(value.uploadConcurrency)||3)))}}
function loadSettings(){try{settings=normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(),'utf8')))}catch{settings=normalizeSettings()}}
function saveSettings(){const target=settingsPath();fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(settings,null,2))}
function uniqueDownloadPath(name, subDir = '') {
  const parsed=path.parse(safeFilename(name));
  const baseDir=settings.downloadDirectory||app.getPath('downloads');
  const sanitized=sanitizeSubDir(subDir);
  const directory=sanitized?path.join(baseDir,...sanitized.split('/')):baseDir;
  fs.mkdirSync(directory,{recursive:true});
  let candidate=path.join(directory,parsed.base), index=1;
  while(fs.existsSync(candidate)){candidate=path.join(directory,`${parsed.name} (${index++})${parsed.ext}`)}
  return candidate;
}
function downloadsPath(){return path.join(app.getPath('userData'),'downloads.json')}
function loadDownloadHistory(){
  try{downloadHistory=JSON.parse(fs.readFileSync(downloadsPath(),'utf8'));if(!Array.isArray(downloadHistory))downloadHistory=[]}catch{downloadHistory=[]}
  downloadHistory=downloadHistory.slice(0,200).map(task=>['queued','progress'].includes(task.state)?{...task,state:'interrupted',error:'应用上次退出时下载尚未完成'}:task);
}
function flushDownloadHistory(){
  try{const target=downloadsPath();fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(downloadHistory.slice(0,200),null,2))}catch(error){console.warn('Failed to save download history',error)}
}
function saveDownloadHistory(){clearTimeout(downloadSaveTimer);downloadSaveTimer=setTimeout(flushDownloadHistory,300)}
function rememberDownload(task){
  const index=downloadHistory.findIndex(item=>item.id===task.id);
  const value={...(index>=0?downloadHistory[index]:{}),...task,updatedAt:Date.now()};
  if(index>=0)downloadHistory.splice(index,1);downloadHistory.unshift(value);downloadHistory=downloadHistory.slice(0,200);saveDownloadHistory();return value;
}
function emitDownload(task) {
  const saved=rememberDownload(task);
  if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('download:event',saved);
}
function scheduleDownloads(){
  while(activeDownloads<settings.downloadConcurrency&&downloadQueue.length&&mainWindow&&!mainWindow.isDestroyed()){
    const entry=downloadQueue.shift();
    activeDownloads++;
    const timer=setTimeout(()=>{
      const idx=pendingDownloads.findIndex(p=>p.task.id===entry.task.id);
      if(idx>=0){
        pendingDownloads.splice(idx,1);
        activeDownloads=Math.max(0,activeDownloads-1);
        logger.warn('download','Download initiation timed out',{id:entry.task.id,name:entry.task.name});
        emitDownload({id:entry.task.id,name:entry.task.name,state:'failed',error:'下载启动超时，请重试',received:0,total:0,percent:0});
        scheduleDownloads();
      }
    },10000);
    pendingDownloads.push({task:entry.task,timer});
    mainWindow.webContents.downloadURL(entry.url);
  }
}
function installDownloadManager() {
  session.defaultSession.on('will-download',(_event,item)=>{
    const pending=pendingDownloads.shift();
    if(pending?.timer)clearTimeout(pending.timer);
    const request=pending?.task || {id:crypto.randomUUID(),name:item.getFilename(),subDir:''};
    const savePath=request.path || uniqueDownloadPath(request.name || item.getFilename(), request.subDir || '');
    item.setSavePath(savePath); downloadItems.set(request.id,item);
    const snapshot=(state,error='')=>({
      id:request.id,
      name:path.basename(savePath),
      subDir:request.subDir||'',
      url:request.url||'',
      path:savePath,
      state,
      error,
      received:item.getReceivedBytes(),
      total:item.getTotalBytes(),
      percent:item.getTotalBytes()>0?Math.round(item.getReceivedBytes()/item.getTotalBytes()*100):0,
      urlChain:typeof item.getURLChain==='function'?item.getURLChain():(request.urlChain||[request.url].filter(Boolean)),
      eTag:typeof item.getETag==='function'?item.getETag():(request.eTag||''),
      lastModified:typeof item.getLastModifiedTime==='function'?item.getLastModifiedTime():(request.lastModified||''),
      startTime:typeof item.getStartTime==='function'?item.getStartTime():(request.startTime||0)
    });
    emitDownload(snapshot('progress'));
    item.on('updated',(_e,state)=>emitDownload(snapshot(state==='interrupted'?'interrupted':'progress')));
    item.once('done',(_e,state)=>{downloadItems.delete(request.id);activeDownloads=Math.max(0,activeDownloads-1);emitDownload(snapshot(state,state==='interrupted'?'下载中断':''));scheduleDownloads()});
  });
}

function uploadsPath(){return path.join(app.getPath('userData'),'uploads.json')}
function uploadResumesPath(){return path.join(app.getPath('userData'),'upload_resumes.json')}
let uploadResumes={};
let uploadResumesTimer=null;
function loadUploadResumes(){try{const value=JSON.parse(fs.readFileSync(uploadResumesPath(),'utf8'));uploadResumes=value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{uploadResumes={}}}
function flushUploadResumes(){try{const target=uploadResumesPath();fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(uploadResumes,null,2))}catch(error){logger.warn('upload','Failed to save upload resumes',error)}}
function saveUploadResumes(){clearTimeout(uploadResumesTimer);uploadResumesTimer=setTimeout(flushUploadResumes,300)}

function playbackPath(){return path.join(app.getPath('userData'),'playback.json')}
function loadPlaybackHistory(){try{const value=JSON.parse(fs.readFileSync(playbackPath(),'utf8'));playbackHistory=value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{playbackHistory={}}}
function flushPlaybackHistory(){try{const entries=Object.entries(playbackHistory).sort((a,b)=>Number(b[1]?.updatedAt||0)-Number(a[1]?.updatedAt||0)).slice(0,1000);playbackHistory=Object.fromEntries(entries);const target=playbackPath();fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(playbackHistory,null,2))}catch(error){logger.warn('playback','Failed to save playback history',error)}}
function loadUploadHistory(){try{uploadHistory=JSON.parse(fs.readFileSync(uploadsPath(),'utf8'));if(!Array.isArray(uploadHistory))uploadHistory=[]}catch{uploadHistory=[]}uploadHistory=uploadHistory.slice(0,200).map(task=>['queued','hashing','uploading'].includes(task.state)?{...task,state:'interrupted',error:'应用上次退出时上传尚未完成'}:task)}
function flushUploadHistory(){try{const target=uploadsPath();fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(uploadHistory.slice(0,200),null,2))}catch(error){logger.warn('upload','Failed to save upload history',error)}}
function rememberUpload(value){const index=uploadHistory.findIndex(item=>item.id===value.id),saved={...(index>=0?uploadHistory[index]:{}),...value,updatedAt:Date.now()};if(index>=0)uploadHistory.splice(index,1);uploadHistory.unshift(saved);uploadHistory=uploadHistory.slice(0,200);clearTimeout(uploadSaveTimer);uploadSaveTimer=setTimeout(flushUploadHistory,300);return saved}
function uploadEvent(value){const saved=rememberUpload(value);if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('upload:event',saved)}
function sha1(value){return crypto.createHash('sha1').update(value).digest()}
async function readFileRange(handle,start,length){const buffer=Buffer.alloc(length),result=await handle.read(buffer,0,length,start);return buffer.subarray(0,result.bytesRead)}
async function calculateUploadHash(filePath,size,onProgress,signal){
  const handle=await fs.promises.open(filePath,'r');
  try{
    const sample=0x5000;let cid;
    if(size<0xF000)cid=sha1(await readFileRange(handle,0,size));
    else cid=sha1(Buffer.concat([await readFileRange(handle,0,sample),await readFileRange(handle,Math.floor(size/3),sample),await readFileRange(handle,Math.max(0,size-sample),sample)]));
    let partSize=0x40000;while(size/partSize>0x200&&partSize<0x200000)partSize<<=1;
    const digests=[];if(size===0)digests.push(sha1(Buffer.alloc(0)));
    for(let offset=0;offset<size;offset+=partSize){if(signal?.aborted)throw new DOMException('Aborted','AbortError');digests.push(sha1(await readFileRange(handle,offset,Math.min(partSize,size-offset))));onProgress?.(Math.round(Math.min(size,offset+partSize)/Math.max(1,size)*100))}
    return {cid:cid.toString('hex').toUpperCase(),gcid:sha1(Buffer.concat(digests)).toString('hex').toUpperCase()};
  }finally{await handle.close()}
}
function ossEncode(value){return encodeURIComponent(String(value)).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)}
function ossQuery(value='',encode=false){return String(value).split('&').filter(Boolean).map(part=>{const index=part.indexOf('=');return index<0?[part,null]:[part.slice(0,index),part.slice(index+1)]}).sort((a,b)=>a[0].localeCompare(b[0])).map(([key,val])=>val===null?key:`${key}=${encode?ossEncode(val):val}`).join('&')}
async function uploadToOss(filePath,size,mime,params,controller,onProgress,resumeKey=''){
  const objectPath=String(params.key).split('/').map(ossEncode).join('/'),endpoint=String(params.endpoint||'').replace(/^https?:\/\//i,'').replace(/\/+$/,''),host=params.cname===true||String(params.cname).toLowerCase()==='true'?`https://${endpoint}`:`https://${params.bucket}.${endpoint}`;
  const request=async(method,query='',body=null,contentType='')=>{const date=new Date().toUTCString(),canonical=ossQuery(query),resource=`/${params.bucket}/${objectPath}${canonical?'?'+canonical:''}`,headersBlock=`x-oss-date:${date}\nx-oss-security-token:${params.security_token}`,signText=[method,'',contentType,date,headersBlock,resource].join('\n'),signature=crypto.createHmac('sha1',params.access_key_secret).update(signText).digest('base64'),headers={Authorization:`OSS ${params.access_key_id}:${signature}`,'x-oss-date':date,'x-oss-security-token':params.security_token};if(contentType)headers['content-type']=contentType;const response=await fetch(`${host}/${objectPath}${query?'?'+ossQuery(query,true):''}`,{method,headers,body,signal:controller.signal});const text=await response.text();if(!response.ok)throw new Error(`OSS ${method} 失败 (${response.status})`);return {text,headers:response.headers}};

  let uploadId='',parts=[];
  if(resumeKey&&uploadResumes[resumeKey]?.uploadId&&uploadResumes[resumeKey]?.objectPath===objectPath){
    uploadId=uploadResumes[resumeKey].uploadId;
    parts=Array.isArray(uploadResumes[resumeKey].parts)?[...uploadResumes[resumeKey].parts]:[];
    logger.info('upload','Resuming multipart upload from saved state',{uploadId,completedParts:parts.length});
  }else{
    const init=await request('POST','uploads');
    uploadId=init.text.match(/<UploadId>([^<]+)<\/UploadId>/i)?.[1];
    if(!uploadId)throw new Error('未获取到分片上传 ID');
    if(resumeKey){
      uploadResumes[resumeKey]={uploadId,objectPath,parts:[],createdAt:Date.now()};
      saveUploadResumes();
    }
  }

  let partSize=1024*1024;while(size/partSize>10000)partSize*=2;
  const completedMap=new Map(parts.map(p=>[Number(p.number),String(p.etag)]));
  const handle=await fs.promises.open(filePath,'r');
  try{
    for(let number=1,offset=0;offset<size;number++,offset+=partSize){
      const chunkLength=Math.min(partSize,size-offset);
      if(completedMap.has(number)){
        onProgress(Math.round(Math.min(size,offset+chunkLength)/Math.max(1,size)*100));
        continue;
      }
      const chunk=await readFileRange(handle,offset,chunkLength);
      const result=await request('PUT',`partNumber=${number}&uploadId=${uploadId}`,chunk,mime);
      const etag=result.headers.get('etag');
      if(!etag)throw new Error(`上传分片 ${number} 缺少 ETag`);
      parts.push({number,etag});
      completedMap.set(number,etag);
      if(resumeKey&&uploadResumes[resumeKey]){
        uploadResumes[resumeKey].parts=parts;
        saveUploadResumes();
      }
      onProgress(Math.round(Math.min(size,offset+chunk.length)/Math.max(1,size)*100));
    }
  }finally{await handle.close()}

  parts.sort((a,b)=>Number(a.number)-Number(b.number));
  const xml=`<CompleteMultipartUpload>${parts.map(part=>`<Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  await request('POST',`uploadId=${uploadId}`,xml,'application/xml');

  if(resumeKey&&uploadResumes[resumeKey]){
    delete uploadResumes[resumeKey];
    saveUploadResumes();
  }
}
async function startLocalUpload(filePath,parentId='',id=crypto.randomUUID()){
  const stat=await fs.promises.stat(filePath);if(!stat.isFile())throw new Error('请选择有效文件');const name=path.basename(filePath),controller=new AbortController();uploadControllers.set(id,controller);
  const emit=(state,percent=0,error='')=>uploadEvent({id,name,size:stat.size,filePath,parentId,state,percent,error});
  try{
    emit('hashing');const hashes=await calculateUploadHash(filePath,stat.size,percent=>emit('hashing',percent),controller.signal);const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
    let gcid=hashes.gcid;try{const query=new URLSearchParams({cid:hashes.cid.toLowerCase(),file_size:String(stat.size)}),known=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/resource/cid?${query}`,{action:'GET:/drive/v1/resource/cid',authorization:account.accessToken});if(known.gcid)gcid=String(known.gcid).toUpperCase()}catch{}
    const data=await driveMutation('/drive/v1/files',{body:{hash:gcid,name,size:String(stat.size),kind:'drive#file',id:'',parent_id:String(parentId||''),upload_type:'UPLOAD_TYPE_RESUMABLE',folder_type:'NORMAL',resumable:{provider:'PROVIDER_ALIYUN'}}});
    if(data.upload_type==='UPLOAD_TYPE_URL'||data.phase==='PHASE_TYPE_COMPLETE'||data.file?.phase==='PHASE_TYPE_COMPLETE'){emit('completed',100);return}
    const params=data.resumable?.params;if(!params)throw new Error('PikPak 未返回上传凭证');emit('uploading');
    const resumeKey=crypto.createHash('sha1').update(`${filePath}:${stat.size}:${Math.floor(stat.mtimeMs)}:${gcid}`).digest('hex');
    await uploadToOss(filePath,stat.size,'application/octet-stream',params,controller,percent=>emit('uploading',percent),resumeKey);
    emit('completed',100);
  }catch(error){emit(error.name==='AbortError'?'cancelled':'failed',0,error.name==='AbortError'?'已取消':error.message);throw error}finally{uploadControllers.delete(id)}
}
function scheduleUploads(){while(activeUploads<settings.uploadConcurrency&&uploadQueue.length){const entry=uploadQueue.shift();activeUploads++;startLocalUpload(entry.filePath,entry.parentId,entry.task.id).catch(()=>{}).finally(()=>{activeUploads--;scheduleUploads()})}}
function queueUploadFile(filePath,parentId,stat,tasks){const task={id:crypto.randomUUID(),name:path.basename(filePath),size:stat.size,filePath,parentId,state:'queued',percent:0};logger.info('upload','Upload task queued',{id:task.id,name:task.name,size:stat.size});tasks.push(task);uploadQueue.push({filePath,parentId,task});uploadEvent(task)}
async function createRemoteFolder(name,parentId){const data=await driveMutation('/drive/v1/files',{body:{kind:'drive#folder',parent_id:parentId||'',name:String(name||'').trim()}}),file=data?.file||data?.data?.file||data;if(!file?.id)throw new Error(`创建远程目录失败：${name}`);return String(file.id)}
async function enqueueDirectory(localDir,parentId,tasks,counter){
  const remoteId=await createRemoteFolder(path.basename(localDir),parentId),entries=await fs.promises.readdir(localDir,{withFileTypes:true});counter.dirs++;
  for(const entry of entries){if(counter.count>=2000)throw new Error('单次文件夹上传最多支持 2000 个文件');if(entry.isSymbolicLink())continue;const localPath=path.join(localDir,entry.name);if(entry.isDirectory())await enqueueDirectory(localPath,remoteId,tasks,counter);else if(entry.isFile()){const stat=await fs.promises.stat(localPath);queueUploadFile(localPath,remoteId,stat,tasks);counter.count++}}
}
async function enqueueLocalUploads(filePaths,parentId=''){
  if(!readAccount().accessToken)throw new Error('请先连接 PikPak 账户');const tasks=[],counter={count:0,dirs:0};
  for(const rawPath of (Array.isArray(filePaths)?filePaths:[]).slice(0,200)){const localPath=path.resolve(String(rawPath||''));let stat;try{stat=await fs.promises.stat(localPath)}catch{continue}if(stat.isDirectory())await enqueueDirectory(localPath,parentId,tasks,counter);else if(stat.isFile()){queueUploadFile(localPath,parentId,stat,tasks);counter.count++}}
  if(!tasks.length&&!counter.dirs)throw new Error('没有可上传的本机文件');scheduleUploads();return tasks;
}

function getShareBridgeWindow() {
  if (shareBridgeWindow && !shareBridgeWindow.isDestroyed()) return shareBridgeWindow;
  shareBridgeWindow = new BrowserWindow({
    show:false, width:1100, height:760,
    webPreferences:{session:session.fromPartition('persist:pikpak-login'),contextIsolation:true,nodeIntegration:false,sandbox:true}
  });
  shareBridgeWindow.on('closed',()=>{shareBridgeWindow=null});
  return shareBridgeWindow;
}
async function scrapeShareDirectory(rawUrl) {
  const win=getShareBridgeWindow();
  await win.loadURL(rawUrl);
  return win.webContents.executeJavaScript(`new Promise(resolve=>{
    const started=Date.now();
    const read=()=>{
      const scope=document.querySelector('.file-list,.list-content,.files-viewport,.file-explorer');
      const rows=scope?[...scope.querySelectorAll('li[id],[data-encoded-id][id],[role="row"][id]')]:[];
      if(rows.length||scope||Date.now()-started>12000){
        resolve(rows.map(row=>{
          const image=row.querySelector('img');
          const folder=!!row.querySelector('.folder-cover');
          return {id:row.id||row.getAttribute('data-id'),encodedToken:row.getAttribute('data-encoded-id')||'',name:row.getAttribute('aria-label')||row.querySelector('.name')?.textContent?.trim()||'未命名',kind:folder?'drive#folder':'drive#file',thumbnail_link:image?.currentSrc||image?.src||''};
        }).filter(item=>item.id));return;
      }
      setTimeout(read,120);
    };read();
  })`,true);
}
async function openShareDirectory(rawUrl) {
  const share=parseShareUrl(rawUrl);
  const [apiResult,scrapedResult]=await Promise.allSettled([
    listPages(pageToken=>{const query=new URLSearchParams({share_id:share.shareId,parent_id:share.parentToken,limit:'100',thumbnail_size:'SIZE_LARGE'});if(share.passCode)query.set('pass_code',share.passCode);if(pageToken)query.set('page_token',pageToken);return `https://api-drive.mypikpak.com/drive/v1/share?${query}`},{action:'GET:/drive/v1/share'}),
    scrapeShareDirectory(share.url)
  ]);
  if(apiResult.status==='rejected'&&scrapedResult.status==='rejected')throw apiResult.reason;
  const data=apiResult.status==='fulfilled'?apiResult.value:{files:[],raw:{}};
  const scraped=scrapedResult.status==='fulfilled'?scrapedResult.value:[];
  return {share:{...share,passCodeToken:data.raw?.pass_code_token || data.raw?.passCodeToken || data.raw?.data?.pass_code_token || ''},files:mergeShareFiles(data.files,scraped),bridgeAvailable:scrapedResult.status==='fulfilled',raw:data.raw};
}

ipcMain.handle('account:get', () => accountStatus());
ipcMain.handle('account:about', async () => {
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  const data=await apiRequest('https://api-drive.mypikpak.com/drive/v1/about',{action:'GET:/drive/v1/about',authorization:account.accessToken});
  return {quota:normalizeQuota(data),user:data.user || null,kind:data.kind || ''};
});
ipcMain.handle('account:set-token', (_, token) => { writeAccount({ accessToken:token, source:'manual-token' }); return { connected:!!token }; });
ipcMain.handle('account:login',()=>new Promise(resolve=>{loginCompletion=resolve;openLoginWindow()}));
ipcMain.handle('account:logout',async()=>{clearAccount();rotateDeviceId();await session.fromPartition('persist:pikpak-login').clearStorageData();return accountStatus()});
ipcMain.handle('share:open', async (_, rawUrl) => openShareDirectory(rawUrl));
ipcMain.handle('share:file-info', async (_, { shareId, fileId }) => {
  const query = new URLSearchParams({ share_id:shareId, file_id:fileId, thumbnail_size:'SIZE_LARGE' });
  return apiRequest(`https://api-drive.mypikpak.com/drive/v1/share/file_info?${query}`, { action:'GET:/drive/v1/share/file_info' });
});
ipcMain.handle('archive:list',async(_,{scope='drive',fileId,shareId='',passCodeToken='',path:archivePath='',password=''})=>{
  fileId=String(fileId||'');if(!fileId)throw new Error('压缩包文件 ID 无效');
  let detail,listUrl='https://api-drive.mypikpak.com/decompress/v1/list',authorization='';
  if(scope==='share'){
    const query=new URLSearchParams({share_id:String(shareId||''),file_id:fileId,thumbnail_size:'SIZE_SMALL'});if(passCodeToken)query.set('pass_code_token',String(passCodeToken));
    detail=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/share/file_info?${query}`,{action:'GET:/drive/v1/share/file_info'});detail=detail?.file||detail?.data?.file||detail;
    const accessToken=archiveAccessToken(detail);if(!accessToken)throw new Error('该分享暂未提供压缩包查看权限');
    listUrl+=`?access_token=${encodeURIComponent(accessToken)}`;
  }else{
    const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');authorization=account.accessToken;
    detail=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/files/${encodeURIComponent(fileId)}?thumbnail_size=SIZE_SMALL`,{action:'GET:/drive/v1/files/{id}',authorization});detail=detail?.file||detail?.data?.file||detail;
  }
  const body={gcid:detail.gcid||detail.hash||detail.md5_checksum||'',file_id:fileId,password:String(password||''),path:String(archivePath||'')};
  try{
    const data=await apiRequest(listUrl,{action:'POST:/decompress/v1/list',method:'POST',body,authorization});
    const status=String(data?.status||'OK').toUpperCase(),value=JSON.stringify(data||{}).toLowerCase();
    if(status!=='OK'){if(/password|pass_word|10023/.test(value))return {passwordRequired:true,message:'压缩包需要密码或密码不正确'};throw new Error(data.status_text||data.error_description||data.msg||`压缩包索引状态：${status}`)}
    return {name:detail.name||'',path:body.path,items:archiveItemsFrom(data),status:data.status||'OK'};
  }catch(error){
    const value=JSON.stringify(error.data||{}).toLowerCase()+' '+String(error.message||'').toLowerCase();
    if(/password|pass_word|10023/.test(value))return {passwordRequired:true,message:'压缩包需要密码或密码不正确'};
    throw error;
  }
});
ipcMain.handle('share:restore', async (_, payload) => {
  return driveMutation('/drive/v1/share/restore',{body:buildShareRestorePayload(payload)});
});
ipcMain.handle('share:create', async (_, payload) => {
  const raw=await driveMutation('/drive/v1/share',{body:buildCreateSharePayload(payload.ids,{expirationDays:payload.expirationDays,encrypted:payload.encrypted})});
  const data=raw?.data && typeof raw.data==='object'?raw.data:raw;
  if(!data?.share_url)throw new Error(data?.error_description||'未获取到分享链接');
  const text=data.pass_code?`${data.share_url}\n提取码：${data.pass_code}`:data.share_url;clipboard.writeText(text);
  return {shareId:data.share_id||'',shareUrl:data.share_url,passCode:data.pass_code||'',text};
});
ipcMain.handle('shares:list', async () => {
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  const items=[];let pageToken='';
  for(let page=0;page<50;page++){
    const query=new URLSearchParams({limit:'100',thumbnail_size:'SIZE_SMALL'});if(pageToken)query.set('page_token',pageToken);
    const data=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/share/list?${query}`,{action:'GET:/drive/v1/share/list',authorization:account.accessToken});
    items.push(...(Array.isArray(data.data)?data.data:Array.isArray(data.shares)?data.shares:[]));pageToken=data.next_page_token||'';if(!pageToken)break;
  }
  return {files:normalizeShareList(items)};
});
ipcMain.handle('shares:cancel',(_,ids)=>driveMutation('/drive/v1/share:batchDelete',{body:{ids:normalizeIds(ids)}}));
ipcMain.handle('shares:copy',(_,item)=>{const url=String(item?.shareUrl||'');if(!/^https?:\/\//i.test(url))throw new Error('分享链接无效');const text=item?.passCode?`${url}\n提取码：${item.passCode}`:url;clipboard.writeText(text);return text});
ipcMain.handle('offline:create', async (_, value) => {const payload=value&&typeof value==='object'?value:{url:value};return driveMutation('/drive/v1/files',{body:buildOfflineTaskPayload(payload.url,payload.parentId)});});
ipcMain.handle('offline:list', async () => {
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  const query=new URLSearchParams({type:'offline',limit:'100',thumbnail_size:'SIZE_SMALL',with_reference_resource:'true'});
  const data=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/tasks?${query}`,{action:'GET:/drive/v1/tasks',authorization:account.accessToken});
  return {tasks:data.tasks || data.data?.tasks || []};
});
ipcMain.handle('offline:delete', async (_, id) => {
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  const query=new URLSearchParams({task_ids:String(id),delete_files:'false'});
  return apiRequest(`https://api-drive.mypikpak.com/drive/v1/tasks?${query}`,{action:'DELETE:/drive/v1/tasks',method:'DELETE',authorization:account.accessToken});
});
ipcMain.handle('drive:list', async (_, parentId='') => {
  const account = readAccount(); if (!account.accessToken) throw new Error('请先连接 PikPak 账户');
  return listPages(pageToken=>{const query=new URLSearchParams({parent_id:parentId,limit:'100',thumbnail_size:'SIZE_LARGE',with_audit:'true'});if(pageToken)query.set('page_token',pageToken);return `https://api-drive.mypikpak.com/drive/v1/files?${query}`},{action:'GET:/drive/v1/files',authorization:account.accessToken});
});
let activeSearchController = null;
ipcMain.handle('drive:search',async(_,rawQuery)=>{
  const query=String(rawQuery||'').trim().toLocaleLowerCase();if(query.length<2)throw new Error('全盘搜索至少输入 2 个字符');const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  if(activeSearchController){activeSearchController.abort();activeSearchController=null}
  const controller=new AbortController();activeSearchController=controller;
  const pending=[{id:'',names:[]}],visited=new Set(),matches=[];let scanned=0,truncated=false;
  try{
    while(pending.length&&visited.size<5000&&scanned<50000&&matches.length<500){
      if(controller.signal.aborted)throw new DOMException('Search aborted','AbortError');
      const batch=[];while(pending.length&&batch.length<4){const folder=pending.shift();if(!visited.has(folder.id)){visited.add(folder.id);batch.push(folder)}}
      const results=await Promise.all(batch.map(async folder=>{
        if(controller.signal.aborted)throw new DOMException('Search aborted','AbortError');
        const value=await listPages(pageToken=>{const params=new URLSearchParams({parent_id:folder.id,limit:'100',thumbnail_size:'SIZE_MEDIUM'});if(pageToken)params.set('page_token',pageToken);return `https://api-drive.mypikpak.com/drive/v1/files?${params}`},{action:'GET:/drive/v1/files',authorization:account.accessToken});return {folder,files:value.files};
      }));
      for(const result of results){for(const item of result.files){scanned++;const names=[...result.folder.names,item.name||''];if(String(item.name||'').toLocaleLowerCase().includes(query))matches.push({...item,_search_path:names.join(' / '),_search_parent_id:result.folder.id});if(item.kind==='drive#folder'&&!visited.has(item.id))pending.push({id:item.id,names});if(scanned>=50000||matches.length>=500)break}}
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('search:progress',{scanned,folders:visited.size,matchesCount:matches.length,isDone:false});
    }
    if(pending.length||visited.size>=5000||scanned>=50000||matches.length>=500)truncated=true;return {files:matches,scanned,folders:visited.size,truncated};
  }catch(err){
    if(err.name==='AbortError')return {files:matches,scanned,folders:visited.size,truncated:true,cancelled:true};
    throw err;
  }finally{
    if(activeSearchController===controller)activeSearchController=null;
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('search:progress',{scanned,folders:visited.size,matchesCount:matches.length,isDone:true});
  }
});
ipcMain.handle('drive:search-cancel',()=>{if(activeSearchController){activeSearchController.abort();activeSearchController=null;return true}return false});
ipcMain.handle('drive:file-info', async (_, fileId) => {
  const account = readAccount(); if (!account.accessToken) throw new Error('请先连接 PikPak 账户');
  return apiRequest(`https://api-drive.mypikpak.com/drive/v1/files/${encodeURIComponent(fileId)}?thumbnail_size=SIZE_LARGE`, { action:'GET:/drive/v1/files/{id}', authorization:account.accessToken });
});
ipcMain.handle('starred:list', async () => {
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  return listPages(pageToken=>{const query=new URLSearchParams({parent_id:'*',limit:'100',thumbnail_size:'SIZE_LARGE',filters:JSON.stringify({trashed:{eq:false},system_tag:{in:'STAR'}})});if(pageToken)query.set('page_token',pageToken);return `https://api-drive.mypikpak.com/drive/v1/files?${query}`},{action:'GET:/drive/v1/files',authorization:account.accessToken});
});
ipcMain.handle('recent:list', async () => {
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  const events=[];let pageToken='';
  for(let page=0;page<5;page++){
    const query=new URLSearchParams({limit:'100',thumbnail_size:'SIZE_LARGE'});if(pageToken)query.set('page_token',pageToken);
    const data=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/events?${query}`,{action:'GET:/drive/v1/events',authorization:account.accessToken});
    events.push(...(Array.isArray(data.events)?data.events:Array.isArray(data.data)?data.data:[]));pageToken=data.next_page_token||data.nextPageToken||'';if(!pageToken)break;
  }
  return {files:recentFilesFromEvents(events)};
});
ipcMain.handle('drive:star',(_,payload)=>driveMutation(`/drive/v1/files:${payload.starred?'star':'unstar'}`,{body:{ids:normalizeIds(payload.ids||payload.id)}}));
ipcMain.handle('drive:create-folder',(_,payload)=>driveMutation('/drive/v1/files',{body:{kind:'drive#folder',parent_id:payload.parentId || '',name:String(payload.name||'').trim()}}));
ipcMain.handle('drive:rename',(_,payload)=>driveMutation(`/drive/v1/files/${encodeURIComponent(payload.id)}`,{method:'PATCH',body:{name:String(payload.name||'').trim()}}));
ipcMain.handle('drive:trash',(_,ids)=>driveMutation('/drive/v1/files:batchTrash',{body:{ids:normalizeIds(ids)}}));
ipcMain.handle('drive:transfer',(_,payload)=>{
  const endpoint=payload.operation==='move'?'batchMove':'batchCopy';
  return driveMutation(`/drive/v1/files:${endpoint}`,{body:{ids:payload.ids,to:{parent_id:payload.parentId || ''}}});
});
ipcMain.handle('trash:list',async()=>{
  const account=readAccount();if(!account.accessToken)throw new Error('请先连接 PikPak 账户');
  return listPages(pageToken=>{const query=new URLSearchParams({parent_id:'*',limit:'100',thumbnail_size:'SIZE_LARGE',filters:JSON.stringify({trashed:{eq:true}})});if(pageToken)query.set('page_token',pageToken);return `https://api-drive.mypikpak.com/drive/v1/files?${query}`},{action:'GET:/drive/v1/files',authorization:account.accessToken});
});
ipcMain.handle('trash:restore',(_,ids)=>driveMutation('/drive/v1/files:batchUntrash',{body:{ids:normalizeIds(ids)}}));
ipcMain.handle('trash:delete',(_,ids)=>driveMutation('/drive/v1/files:batchDelete',{body:{ids:normalizeIds(ids)}}));
ipcMain.handle('download:start',(_,{url,name,subDir=''})=>{
  if(!/^https?:\/\//i.test(String(url||'')))throw new Error('无效的下载地址');
  if(!mainWindow||mainWindow.isDestroyed())throw new Error('主窗口不可用');
  const task={id:crypto.randomUUID(),name:safeFilename(name),subDir:sanitizeSubDir(subDir),url:String(url),state:'queued',received:0,total:0,percent:0};
  logger.info('download','Download task queued',{id:task.id,name:task.name,subDir:task.subDir});
  downloadQueue.push({task,url});emitDownload(task);scheduleDownloads();return task;
});
ipcMain.handle('settings:get',()=>({...settings,effectiveDownloadDirectory:settings.downloadDirectory||app.getPath('downloads')}));
ipcMain.handle('settings:choose-download-dir',async()=>{const picked=await dialog.showOpenDialog(mainWindow||undefined,{title:'选择默认下载目录',properties:['openDirectory','createDirectory']});return picked.canceled?'':picked.filePaths[0]||''});
ipcMain.handle('settings:set',(_,value)=>{settings=normalizeSettings(value);saveSettings();scheduleDownloads();scheduleUploads();return {...settings,effectiveDownloadDirectory:settings.downloadDirectory||app.getPath('downloads')}});
ipcMain.handle('settings:reset',()=>{settings=normalizeSettings({});saveSettings();logger.info('settings','Settings reset to default');scheduleDownloads();scheduleUploads();return {...settings,effectiveDownloadDirectory:settings.downloadDirectory||app.getPath('downloads')}});
ipcMain.handle('app:export-diagnostics',async()=>{logger.info('app','Exporting diagnostics report');return logger.buildDiagnostics({appVersion:app.getVersion(),account:accountStatus(),settings:{...settings,effectiveDownloadDirectory:settings.downloadDirectory||app.getPath('downloads')},transferStats:{activeDownloads,queuedDownloads:downloadQueue.length,totalDownloadsRecorded:downloadHistory.length,activeUploads,queuedUploads:uploadQueue.length,totalUploadsRecorded:uploadHistory.length}})});
ipcMain.handle('upload:choose',async(_,{parentId='' }={})=>{
  if(!readAccount().accessToken)throw new Error('请先连接 PikPak 账户');
  const picked=await dialog.showOpenDialog(mainWindow||undefined,{title:'选择要上传到 PikPak 的文件',properties:['openFile','multiSelections']});if(picked.canceled)return [];
  return enqueueLocalUploads(picked.filePaths,parentId);
});
ipcMain.handle('upload:choose-folder',async(_,{parentId='' }={})=>{if(!readAccount().accessToken)throw new Error('请先连接 PikPak 账户');const picked=await dialog.showOpenDialog(mainWindow||undefined,{title:'选择要上传到 PikPak 的文件夹',properties:['openDirectory']});if(picked.canceled)return [];return enqueueLocalUploads(picked.filePaths,parentId)});
ipcMain.handle('upload:paths',(_,payload)=>enqueueLocalUploads(payload?.paths,payload?.parentId||''));
ipcMain.handle('upload:cancel',(_,id)=>{id=String(id||'');const queued=uploadQueue.findIndex(entry=>entry.task.id===id);if(queued>=0){const [entry]=uploadQueue.splice(queued,1);uploadEvent({...entry.task,state:'cancelled',error:'已取消'});return true}const controller=uploadControllers.get(id);if(controller)controller.abort();return !!controller});
ipcMain.handle('upload:list',()=>uploadHistory);
ipcMain.handle('upload:remove',(_,id)=>{uploadHistory=uploadHistory.filter(item=>item.id!==String(id||''));clearTimeout(uploadSaveTimer);uploadSaveTimer=setTimeout(flushUploadHistory,50);return uploadHistory});
ipcMain.handle('upload:clear',()=>{uploadHistory=uploadHistory.filter(item=>['queued','hashing','uploading'].includes(item.state));clearTimeout(uploadSaveTimer);uploadSaveTimer=setTimeout(flushUploadHistory,50);return uploadHistory});
ipcMain.handle('viewer:open',async(_,{url,name,fileId='',mimeType,sources=[],items=[],subtitles=[]})=>{
  const target=String(url||'');if(!/^https?:\/\//i.test(target))throw new Error('当前文件没有可用的查看地址');
  const kind=previewKind(name,mimeType);
  if(!kind)throw new Error('此文件类型暂不支持预览，请使用“下载到本机”');
  const viewerSession=session.fromPartition('pikpak-viewer');if(!viewerDownloadsBlocked){viewerDownloadsBlocked=true;viewerSession.on('will-download',event=>event.preventDefault())}
  fileId=String(fileId||'');
  const win=new BrowserWindow({width:1100,height:760,minWidth:720,minHeight:480,title:String(name||'文件查看'),autoHideMenuBar:true,backgroundColor:'#111827',parent:mainWindow||undefined,webPreferences:{session:viewerSession,preload:path.join(__dirname,'viewer-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  viewerWindows.add(win);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const safeSources=(Array.isArray(sources)?sources:[]).slice(0,10).map(source=>({url:String(source?.url||''),label:String(source?.label||'清晰度').slice(0,30)})).filter(source=>/^https?:\/\//i.test(source.url));
  const safeItems=(Array.isArray(items)?items:[]).slice(0,60).map(item=>({id:String(item?.id||''),name:String(item?.name||'图片').slice(0,300),url:String(item?.url||'')})).filter(item=>/^https?:\/\//i.test(item.url));
  const safeSubtitles=(Array.isArray(subtitles)?subtitles:[]).slice(0,15).map(sub=>({id:String(sub?.id||''),name:String(sub?.name||'字幕').slice(0,120),url:String(sub?.url||'')})).filter(sub=>/^https?:\/\//i.test(sub.url));
  const token=crypto.randomUUID(),viewerWebContentsId=win.webContents.id;viewerPayloads.set(token,{webContentsId:viewerWebContentsId,payload:{url:target,name:String(name||'文件查看'),kind,fileId,sources:safeSources,items:safeItems,subtitles:safeSubtitles}});win.on('closed',()=>{playingViewers.delete(viewerWebContentsId);updatePlaybackPowerBlocker();viewerWindows.delete(win);viewerPayloads.delete(token)});
  await win.loadFile(path.join(__dirname,'viewer.html'),{query:{token}});return true;
});
ipcMain.handle('app:clear-cache',async()=>{
  downloadHistory=[];uploadHistory=[];playbackHistory={};
  saveDownloadHistory();flushUploadHistory();flushPlaybackHistory();
  try{await session.defaultSession.clearCache()}catch(err){logger.warn('app','Failed to clear session cache',err)}
  logger.info('app','Application cache and histories cleared');
  return true;
});
ipcMain.handle('viewer:payload-get',(event,token)=>{const entry=viewerPayloads.get(String(token||''));if(!entry||entry.webContentsId!==event.sender.id)throw new Error('查看会话已失效，请重新打开文件');return entry.payload});
function viewerFor(event){const win=BrowserWindow.fromWebContents(event.sender);if(!win||!viewerWindows.has(win))throw new Error('无效的查看窗口');return win}
ipcMain.handle('viewer:playing',(event,isPlaying)=>{viewerFor(event);if(isPlaying)playingViewers.add(event.sender.id);else playingViewers.delete(event.sender.id);updatePlaybackPowerBlocker();return playingViewers.size});
ipcMain.handle('viewer:subtitle-choose',async event=>{const win=viewerFor(event),picked=await dialog.showOpenDialog(win,{title:'选择字幕文件',properties:['openFile'],filters:[{name:'字幕文件',extensions:['srt','vtt','ass','ssa']}]});if(picked.canceled||!picked.filePaths[0])return null;const filePath=picked.filePaths[0],stat=await fs.promises.stat(filePath);if(stat.size>10*1024*1024)throw new Error('字幕文件不能超过 10 MB');return {name:path.basename(filePath),text:decodeSubtitleBytes(await fs.promises.readFile(filePath))}});
ipcMain.handle('viewer:subtitle-decode',(event,input)=>{viewerFor(event);const bytes=Buffer.from(input||[]);if(bytes.length>10*1024*1024)throw new Error('字幕文件不能超过 10 MB');return decodeSubtitleBytes(bytes)});
ipcMain.handle('viewer:media-refresh',async event=>{viewerFor(event);const entry=[...viewerPayloads.values()].find(value=>value.webContentsId===event.sender.id),progressId=String(entry?.payload?.fileId||'');if(!entry||!progressId)throw new Error('无法识别当前媒体文件');let detail;if(progressId.startsWith('drive:')){const id=progressId.slice(6),account=readAccount();if(!account.accessToken)throw new Error('登录状态已过期');detail=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/files/${encodeURIComponent(id)}?thumbnail_size=SIZE_LARGE`,{action:'GET:/drive/v1/files/{id}',authorization:account.accessToken})}else if(progressId.startsWith('share:')){const parts=progressId.split(':'),shareId=parts[1],id=parts.slice(2).join(':');const query=new URLSearchParams({share_id:shareId,file_id:id,thumbnail_size:'SIZE_LARGE'});detail=await apiRequest(`https://api-drive.mypikpak.com/drive/v1/share/file_info?${query}`,{action:'GET:/drive/v1/share/file_info'})}else throw new Error('当前媒体不支持刷新地址');const file=detail?.file||detail?.data?.file||detail,sources=playbackSourcesFromFile(file);if(!sources.length)throw new Error('没有获取到新的播放地址');entry.payload.url=sources[0].url;entry.payload.sources=sources.slice(0,10);return {url:entry.payload.url,sources:entry.payload.sources}});
ipcMain.handle('viewer:capture',async(event,payload={})=>{const win=viewerFor(event),rect=payload.rect||{},width=Math.max(1,Math.floor(Number(rect.width)||1)),height=Math.max(1,Math.floor(Number(rect.height)||1)),x=Math.max(0,Math.floor(Number(rect.x)||0)),y=Math.max(0,Math.floor(Number(rect.y)||0));if(width>10000||height>10000)throw new Error('截图区域无效');const image=await win.webContents.capturePage({x,y,width,height}),base=String(payload.name||'视频').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120),stamp=new Date().toISOString().replace(/[:.]/g,'-'),saved=await dialog.showSaveDialog(win,{title:'保存视频截图',defaultPath:`${base}-${stamp}.png`,filters:[{name:'PNG 图片',extensions:['png']}]});if(saved.canceled||!saved.filePath)return '';await fs.promises.writeFile(saved.filePath,image.toPNG());return saved.filePath});
ipcMain.handle('viewer:progress-get',(_,fileId)=>{const id=String(fileId||'');return id&&playbackHistory[id]?playbackHistory[id]:{time:0,duration:0}});
ipcMain.handle('viewer:progress-set',(_,payload)=>{const id=String(payload?.fileId||''),time=Number(payload?.time||0),duration=Number(payload?.duration||0);if(!id||!Number.isFinite(time)||time<0||!Number.isFinite(duration)||duration<0)return false;if(time===0||duration-time<8)delete playbackHistory[id];else playbackHistory[id]={time:Math.min(time,duration||time),duration,updatedAt:Date.now()};clearTimeout(playbackSaveTimer);playbackSaveTimer=setTimeout(flushPlaybackHistory,500);return true});
ipcMain.handle('download:cancel',(_,id)=>{id=String(id||'');const queued=downloadQueue.findIndex(entry=>entry.task.id===id);if(queued>=0){const [entry]=downloadQueue.splice(queued,1);emitDownload({...entry.task,state:'cancelled',error:'已取消'});return true}const item=downloadItems.get(id);if(item)item.cancel();return !!item});
ipcMain.handle('download:show',(_,filePath)=>{if(filePath&&fs.existsSync(filePath))shell.showItemInFolder(filePath);return true});
ipcMain.handle('download:list',()=>downloadHistory);
ipcMain.handle('download:remove',(_,id)=>{downloadHistory=downloadHistory.filter(item=>item.id!==id);saveDownloadHistory();return downloadHistory});
ipcMain.handle('download:clear',()=>{downloadHistory=downloadHistory.filter(item=>['queued','progress'].includes(item.state));saveDownloadHistory();return downloadHistory});

ipcMain.handle('upload:retry',(_,id)=>{
  id=String(id||'');
  const existing=uploadHistory.find(item=>item.id===id);
  if(!existing)throw new Error('未找到该上传任务');
  if(!existing.filePath||!fs.existsSync(existing.filePath))throw new Error('本地源文件不存在，无法重试');
  const alreadyQueued=uploadQueue.some(entry=>entry.task.id===id);
  if(alreadyQueued)return existing;
  const task={id,name:existing.name||path.basename(existing.filePath),size:existing.size||0,filePath:existing.filePath,parentId:existing.parentId||'',state:'queued',percent:0};
  logger.info('upload','Upload task retried',{id:task.id,name:task.name});
  uploadQueue.push({filePath:existing.filePath,parentId:existing.parentId||'',task});
  uploadEvent(task);
  scheduleUploads();
  return task;
});
ipcMain.handle('download:retry',async(_,id)=>{
  id=String(id||'');
  const existing=downloadHistory.find(item=>item.id===id);
  if(!existing)throw new Error('未找到该下载任务');
  if(!existing.url||!/^https?:\/\//i.test(existing.url))throw new Error('下载地址缺失或无效，无法重试');
  if(!mainWindow||mainWindow.isDestroyed())throw new Error('主窗口不可用');
  const alreadyQueued=downloadQueue.some(entry=>entry.task.id===id);
  if(alreadyQueued)return existing;

  let localSize=0;
  if(existing.path){
    try{
      const stat=await fs.promises.stat(existing.path);
      localSize=stat.size;
    }catch{}
  }

  const resumeOpts=buildInterruptedDownloadOptions({task:existing,localSize});
  if(resumeOpts){
    try{
      activeDownloads++;
      const timer=setTimeout(()=>{
        const idx=pendingDownloads.findIndex(p=>p.task.id===existing.id);
        if(idx>=0){
          pendingDownloads.splice(idx,1);
          activeDownloads=Math.max(0,activeDownloads-1);
          logger.warn('download','Resume initiation timed out',{id:existing.id,name:existing.name});
          emitDownload({...existing,state:'failed',error:'断点续传超时，请重试'});
          scheduleDownloads();
        }
      },10000);
      pendingDownloads.push({task:{...existing,state:'queued',received:localSize,percent:existing.total>0?Math.round(localSize/existing.total*100):0},timer});
      session.defaultSession.createInterruptedDownload(resumeOpts);
      logger.info('download','Resuming download via createInterruptedDownload',{id:existing.id,offset:resumeOpts.offset});
      return existing;
    }catch(err){
      logger.warn('download','createInterruptedDownload failed, falling back to regular download',err);
      activeDownloads=Math.max(0,activeDownloads-1);
    }
  }

  const task={...existing,state:'queued',received:0,percent:0};
  logger.info('download','Download task retried',{id:task.id,name:task.name,subDir:task.subDir});
  downloadQueue.push({task,url:existing.url});
  emitDownload(task);
  scheduleDownloads();
  return task;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1380, height: 860, minWidth: 980, minHeight: 640, title:'PikPak Desktop',
    backgroundColor:'#f4f6fa', icon:path.join(__dirname,'..','build','icon.png'), webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false }
  });
  mainWindow=win;
  win.on('closed',()=>{if(mainWindow===win)mainWindow=null});
  if(process.env.PIKPAK_SMOKE_SCREENSHOT){
    win.webContents.once('did-finish-load',()=>setTimeout(async()=>{
      try{
        if(process.env.PIKPAK_SMOKE_EVAL) {
          await win.webContents.executeJavaScript(process.env.PIKPAK_SMOKE_EVAL).catch(()=>{});
          await new Promise(r=>setTimeout(r,400));
        }
        win.show();
        let image,lastError;
        for(let attempt=0;attempt<5&&!image;attempt++){
          try{image=await win.webContents.capturePage()}catch(error){lastError=error;if(attempt<4)await new Promise(r=>setTimeout(r,400))}
        }
        if(!image)throw lastError||new Error('无法捕获客户端窗口');
        fs.writeFileSync(process.env.PIKPAK_SMOKE_SCREENSHOT,image.toPNG())
      }
      catch(error){fs.writeFileSync(process.env.PIKPAK_SMOKE_SCREENSHOT+'.error.txt',String(error?.stack||error))}
      finally{if(process.env.PIKPAK_SMOKE_EXIT==='1')app.quit()}
    },1200));
  }
  win.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{
    if(!isMainFrame)return;
    const html=`<!doctype html><meta charset="utf-8"><title>PikPak Desktop</title><style>body{font-family:system-ui;background:#f4f6fa;color:#25304a;display:grid;place-items:center;height:100vh;margin:0}.box{background:white;padding:36px;border-radius:16px;box-shadow:0 12px 40px #27385d18;text-align:center}small{color:#8b94a5}</style><div class="box"><h2>客户端界面加载失败</h2><p>请重新启动应用；如果问题持续，请保留此错误码。</p><small>${code} · ${description}</small></div>`;
    win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
  });
  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname,'..','dist','index.html'));
}

app.whenReady().then(() => { logger.init(app.getPath('userData')); restoreDeviceId(); logger.info('app', 'Application ready', { version: app.getVersion() }); loadSettings();loadDownloadHistory();loadUploadHistory();loadPlaybackHistory();loadUploadResumes();installPikPakSessionCapture(); installDownloadManager(); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('before-quit',()=>{playingViewers.clear();updatePlaybackPowerBlocker();clearTimeout(downloadSaveTimer);clearTimeout(uploadSaveTimer);clearTimeout(playbackSaveTimer);clearTimeout(uploadResumesTimer);flushDownloadHistory();flushUploadHistory();flushPlaybackHistory();flushUploadResumes()});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

