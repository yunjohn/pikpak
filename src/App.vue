<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const api = window.pikpak || {
  getAccount: async()=>({connected:false}), getAccountAbout:async()=>({quota:null}), onAccountExpired:()=>()=>{}, onAuthState:()=>()=>{}, setAccessToken:async token=>({connected:!!token}), login:async()=>({connected:false}), logout:async()=>({connected:false}), searchExternal:async()=>({results:[]}), copyExternalMagnet:async()=>true, addExternalMagnet:async()=>({}),
  listDrive:async()=>({files:demoFiles}), searchDrive:async()=>({files:[],scanned:0,folders:0}), cancelSearch:async()=>true, onSearchProgress:()=>()=>{}, getDriveFile:async()=>({}), listStarred:async()=>({files:[]}), listRecent:async()=>({files:[]}), listMyShares:async()=>({files:[]}), copyShare:async()=>'', cancelShares:async()=>({}), setStarred:async()=>({}), openShare:async()=>({share:{shareId:'demo'},files:demoFiles}),
  getShareFile:async()=>({}), restoreShare:async()=>({}), createShare:async()=>({shareUrl:'https://mypikpak.com/s/demo',passCode:'1234'}), createOfflineTask:async()=>({}), listOfflineTasks:async()=>({tasks:[]}), deleteOfflineTask:async()=>({}), createFolder:async()=>({}), rename:async()=>({}), trash:async()=>({}), transfer:async()=>({}), listTrash:async()=>({files:[]}), restoreTrash:async()=>({}), deleteTrash:async()=>({}), startDownload:async payload=>({id:'demo',name:payload.name,state:'queued'}), openViewer:async()=>true, listArchive:async()=>({items:[]}), chooseUpload:async()=>[], chooseUploadFolder:async()=>[], uploadDroppedFiles:async()=>[], cancelUpload:async()=>false, retryUpload:async()=>({}), listUploads:async()=>[], removeUpload:async()=>[], clearUploads:async()=>[], getSettings:async()=>({downloadDirectory:'',effectiveDownloadDirectory:'',downloadConcurrency:3,uploadConcurrency:3,externalPlayerPath:'',theme:'system',clipboardMagnet:true}), chooseDownloadDirectory:async()=>'', chooseExternalPlayer:async()=>'', saveSettings:async value=>value, resetSettings:async()=>({downloadDirectory:'',effectiveDownloadDirectory:'',downloadConcurrency:3,uploadConcurrency:3,externalPlayerPath:'',theme:'system',clipboardMagnet:true}), exportDiagnostics:async()=>({}), getAppInfo:async()=>({version:'开发版',buildTime:'',logsDirectory:'',packaged:false,platform:''}), clearAppCache:async()=>true, onUpload:()=>()=>{}, cancelDownload:async()=>true, retryDownload:async()=>({}), showDownload:async()=>true, listDownloads:async()=>[], removeDownload:async()=>[], clearDownloads:async()=>[], onDownload:()=>()=>{}, onOfflineClipboard:()=>()=>{}
};
const demoFiles = [
  {id:'demo-folder',kind:'drive#folder',name:'示例目录',modified_time:new Date().toISOString()},
  {id:'demo-video',kind:'drive#file',name:'欢迎使用 PikPak Desktop.mp4',size:'128849018',mime_type:'video/mp4'}
];
const mode=ref('drive'), files=ref([]), selected=ref(null), selectedIds=ref([]), loading=ref(false), error=ref(''), notice=ref('');
const shareUrl=ref(''), share=ref(null), account=ref({connected:false}), quota=ref(null), token=ref('');
const authState=ref({state:'idle',message:''});
const downloads=ref([]);
const settings=ref({downloadDirectory:'',effectiveDownloadDirectory:'',downloadConcurrency:3,uploadConcurrency:3,externalPlayerPath:'',theme:'system',clipboardMagnet:true});
const themeMedia=window.matchMedia?.('(prefers-color-scheme: dark)');
const appInfo=ref({version:'',buildTime:'',logsDirectory:'',packaged:false,platform:''});
const uploads=ref([]);
const offlineTasks=ref([]), offlineUrl=ref('');
let offlinePollTimer=null,offlineRefreshPromise=null,removeMenuCommandListener=()=>{};
const thumbFailed=ref({});
const dragUpload=ref(false);
const archive=ref({open:false,name:'',items:[],path:'',nodes:[],password:'',loading:false,error:'',request:null});
const shareSaveDialog=ref({open:false,purpose:'share',pendingUrl:'',targetId:'',targetName:'根目录',folders:[],loading:false,path:[{id:'',name:'根目录'}]});
const shareCreateDialog=ref({open:false,expirationDays:7,encrypted:true,items:[]});
const conflictDialog=ref({open:false,operation:'copy',conflicts:[],nonConflicts:[],targetId:'',targetName:'',loading:false});
const batchResultModal=ref({open:false,title:'批量操作完成',operation:'',successCount:0,skipCount:0,failCount:0,details:[]});
const propertiesDialog=ref({open:false,loading:false,item:null});
const contextMenu=ref({open:false,x:0,y:0,item:null});
const confirmDialog=ref({open:false,title:'',message:'',confirmLabel:'确定',danger:false,resolve:null});
const inputDialog=ref({open:false,title:'',message:'',value:'',placeholder:'',type:'text',confirmLabel:'确定',resolve:null});
const query=ref(''), sortBy=ref('name'), sortDirection=ref(1), lastClickedIndex=ref(-1);
const boxSelect=ref({active:false,startX:0,startY:0,curX:0,curY:0});
const filePanelEl=ref(null);
let boxBaseIds=[],boxAdditive=false,boxSuppressClick=false;
const nameCollator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
const globalQuery=ref(''),searchStats=ref(null),searchLive=ref({scanned:0,folders:0,matchesCount:0,isDone:true});
const externalQuery=ref(''),externalResults=ref([]);
let searchGeneration=0;
let pageRequestGeneration=0;
const clipboard=ref(null);
const pathStack=ref([{id:'',name:'全部文件'}]);
const viewCache=new Map();
const NAV_STATE_KEY='pikpak-desktop-navigation-v1';
const folders=computed(()=>files.value.filter(item=>item.kind==='drive#folder'));
const renderedLimit=ref(60);
const visibleFiles=computed(()=>{
  const needle=query.value.trim().toLocaleLowerCase();
  const list=needle?files.value.filter(item=>(item.name||'').toLocaleLowerCase().includes(needle)):files.value.slice();
  const value=item=>sortBy.value==='size'?Number(item.size||0):sortBy.value==='time'?Date.parse(item.modified_time||0)||0:item.name||'';
  return list.sort((a,b)=>{if(a.kind!==b.kind)return a.kind==='drive#folder'?-1:1;const av=value(a),bv=value(b);return (typeof av==='string'?nameCollator.compare(av,bv):(av-bv))*sortDirection.value});
});
const selectedItems=computed(()=>visibleFiles.value.filter(item=>selectedIds.value.includes(item.id)));
const displayFiles=computed(()=>visibleFiles.value.slice(0,renderedLimit.value));
watch([mode,pathStack,query,sortBy,sortDirection],()=>{
  renderedLimit.value=60;
  const visibleIds=new Set(visibleFiles.value.map(item=>item.id));
  if(selectedIds.value.some(id=>!visibleIds.has(id)))selectedIds.value=selectedIds.value.filter(id=>visibleIds.has(id));
  if(selected.value&&!visibleIds.has(selected.value.id))selected.value=null;
});
function applyTheme(theme='system'){
  const value=['light','dark'].includes(theme)?theme:'system';
  const resolved=value==='system'?(themeMedia?.matches?'dark':'light'):value;
  document.documentElement.dataset.theme=value;
  document.documentElement.dataset.resolvedTheme=resolved;
  document.documentElement.style.colorScheme=resolved;
}
const handleSystemThemeChange=()=>{if(settings.value.theme==='system')applyTheme('system')};
themeMedia?.addEventListener?.('change',handleSystemThemeChange);
watch(()=>settings.value.theme,applyTheme,{immediate:true});
function onListScroll(e){
  const el=e.target;
  if(el.scrollHeight-el.scrollTop-el.clientHeight<260){
    if(renderedLimit.value<visibleFiles.value.length){
      renderedLimit.value=Math.min(visibleFiles.value.length,renderedLimit.value+60);
    }
  }
}
const title=computed(()=>mode.value==='drive'?'我的 PikPak':mode.value==='search'?'全盘搜索':mode.value==='starred'?'收藏':mode.value==='recent'?'最近':mode.value==='myshares'?'我的分享':mode.value==='transfers'?'传输中心':mode.value==='trash'?'回收站':mode.value==='settings'?'设置':(share.value?'分享文件':'打开分享'));

function size(value){let n=Number(value);if(!n)return '—';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<4){n/=1024;i++}return `${n.toFixed(i?1:0)} ${u[i]}`}
function highlightedParts(value){
  const text=String(value||''),needle=(mode.value==='search'?globalQuery.value:query.value).trim();
  if(!needle)return [{text,match:false}];
  const parts=[],lower=text.toLocaleLowerCase(),target=needle.toLocaleLowerCase();let start=0,index=lower.indexOf(target);
  while(index>=0){if(index>start)parts.push({text:text.slice(start,index),match:false});parts.push({text:text.slice(index,index+needle.length),match:true});start=index+needle.length;index=lower.indexOf(target,start)}
  if(start<text.length)parts.push({text:text.slice(start),match:false});
  return parts.length?parts:[{text,match:false}];
}
function resetNavigationState(){pathStack.value=[{id:'',name:'全部文件'}];clearSelection()}
function restoreNavigationState(){if(!account.value.connected)return;try{const value=JSON.parse(localStorage.getItem(NAV_STATE_KEY)||'null');if(!value||typeof value!=='object')return;if(Array.isArray(value.path)&&value.path.length&&value.path.length<100)pathStack.value=value.path.map(item=>({id:String(item.id||''),name:String(item.name||'目录').slice(0,200)}))}catch{localStorage.removeItem(NAV_STATE_KEY)}}
function persistNavigationState(){if(mode.value!=='drive'||!account.value.connected)return;try{localStorage.setItem(NAV_STATE_KEY,JSON.stringify({path:pathStack.value}))}catch{}}
function resumeDrive(){const target=pathStack.value.at(-1)||{id:'',name:'全部文件'};return loadDrive(target.id,target.name,'replace')}
function icon(item){if(item.kind==='drive#folder')return '📁';if((item.mime_type||'').startsWith('video/'))return '🎬';if((item.mime_type||'').startsWith('image/'))return '🖼️';if((item.mime_type||'').startsWith('audio/'))return '🎵';return '📄'}
function contentUrl(item){const list=item?.medias||[];return list.find(x=>x.is_origin&&x.link?.url)?.link?.url||item?.web_content_link||list.find(x=>x.link?.url)?.link?.url||''}
function playbackSources(item){const list=Array.isArray(item?.medias)?item.medias:[],rank=value=>{const text=String(value||'').toUpperCase();return text.includes('1080')||text==='FHD'?1080:text.includes('720')||text==='HD'?720:text.includes('480')||text==='SD'?480:0},toUrl=media=>{let url=String(media?.link?.url||'');const type=String(media?.video?.video_type||media?.video_type||'').toLowerCase();if(type==='mpegts'&&!url.includes('ts_downloader'))url=`https://web-vod-xdrive.mypikpak.com/ts_downloader?client_id=UElLUEFLX1dFQg&url=${encodeURIComponent(url.replace(/[?&]ext=\.m3u8(?=&|$)/,'').replace(/[?&]$/,''))}`;return url},label=media=>{const text=String(media?.resolution_name||media?.video_stream_id||'').toUpperCase();return rank(text)?`${rank(text)}P`:(media?.is_origin?'原画':'转码')};const values=[...list.filter(media=>!media?.is_origin&&media?.link?.url).sort((a,b)=>rank(b.resolution_name||b.video_stream_id)-rank(a.resolution_name||a.video_stream_id)).map(media=>({url:toUrl(media),label:label(media)})),...list.filter(media=>media?.is_origin&&media?.link?.url).map(media=>({url:toUrl(media),label:'原画'})),...(item?.web_content_link?[{url:item.web_content_link,label:'原始文件'}]:[])];const seen=new Set();return values.filter(source=>/^https?:\/\//i.test(source.url)&&!seen.has(source.url)&&seen.add(source.url))}
function isVideo(item){return (item?.mime_type||'').startsWith('video/')||/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|m4v|3gp)$/i.test(item?.name||'')}
function isAudio(item){return (item?.mime_type||'').startsWith('audio/')||/\.(mp3|wav|flac|aac|m4a|ogg|opus|ape|wma|amr|m4b|alac|aiff|aif|mid|midi|ra|dts|ac3|dsf|dff)$/i.test(item?.name||'')}
function isImage(item){return (item?.mime_type||'').startsWith('image/')||/\.(jpg|jpeg|png|gif|webp|bmp|avif|svg)$/i.test(item?.name||'')}
function isArchive(item){const mime=(item?.mime_type||'').toLowerCase();return mime.includes('zip')||mime.includes('rar')||mime.includes('7z')||mime.includes('compressed')||mime.includes('archive')||/\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(item?.name||'')}
function canPreview(item){return isArchive(item)||isVideo(item)||isAudio(item)||isImage(item)||(item?.mime_type||'')==='application/pdf'||/\.(pdf|txt|log|md|json|xml|srt|ass|vtt)$/i.test(item?.name||'')||(item?.mime_type||'').startsWith('text/')}
function previewUrl(item){return (isVideo(item)?playbackSources(item)[0]?.url:'')||contentUrl(item)||(isImage(item)?item?.thumbnail_link||'':'')}
function markThumbFailed(item){if(Object.keys(thumbFailed.value).length>300)thumbFailed.value={};thumbFailed.value={...thumbFailed.value,[item.id]:true}}
async function run(work){loading.value=true;error.value='';try{await work()}catch(e){error.value=e.message||String(e)}finally{loading.value=false}}
function invalidatePageRequest(){pageRequestGeneration++;loading.value=false}
async function runPage(work){
  const generation=++pageRequestGeneration;loading.value=true;error.value='';
  const isCurrent=()=>generation===pageRequestGeneration;
  try{await work(isCurrent)}catch(e){if(isCurrent())error.value=e.message||String(e)}finally{if(isCurrent())loading.value=false}
}
function clearSelection(){selected.value=null;selectedIds.value=[]}
function restoreCachedView(key,nextMode){
  const cached=viewCache.get(key);if(!cached)return false;
  invalidatePageRequest();mode.value=nextMode;share.value=cached.share||null;files.value=cached.files.slice();pathStack.value=cached.path.map(item=>({...item}));error.value='';clearSelection();return true;
}
function cacheView(key){viewCache.set(key,{files:files.value.slice(),path:pathStack.value.map(item=>({...item})),share:share.value})}
async function loadDrive(parentId='', name='全部文件',stackMode=parentId?'push':'reset',preferCache=false){
  if(isSentinelId(parentId)){await loadSentinelPage(parentId);return}
  const cacheKey=`drive:${String(parentId||'root')}`;
  if(preferCache&&restoreCachedView(cacheKey,'drive'))return;
  await runPage(async isCurrent=>{
    mode.value='drive';share.value=null;
    const res=await api.listDrive(parentId);
    if(!isCurrent())return;
    if(res?.notFound&&parentId){const root=await api.listDrive('');if(!isCurrent())return;files.value=root.files;pathStack.value=[{id:'',name:'全部文件'}];clearSelection();cacheView('drive:root');notice.value='该目录不存在或已被删除，已返回全部文件';setTimeout(()=>{notice.value=''},3500);return}
    files.value=res.files||[];
    clearSelection();
    if(stackMode==='reset')pathStack.value=[{id:'',name}];
    else if(stackMode==='push')pathStack.value.push({id:parentId,name});
    cacheView(cacheKey)
  })
}
const SENTINEL_IDS=new Set(['starred','recent','trash','myshares','search']);
function isSentinelId(id){return SENTINEL_IDS.has(String(id||''))}
function loadSentinelPage(id){
  const value=String(id||'');
  if(value==='starred')return loadStarred();
  if(value==='recent')return loadRecent();
  if(value==='trash')return loadTrash();
  if(value==='myshares')return loadMyShares();
  if(value==='search'){showSearchPage();return Promise.resolve()}
  return null;
}
async function loadTrash(preferCache=false){if(preferCache&&restoreCachedView('trash','trash'))return;await runPage(async isCurrent=>{mode.value='trash';share.value=null;const result=await api.listTrash();if(!isCurrent())return;files.value=result.files;clearSelection();pathStack.value=[{id:'trash',name:'回收站'}];cacheView('trash')})}
async function loadStarred(preferCache=false){if(preferCache&&restoreCachedView('starred','starred'))return;await runPage(async isCurrent=>{mode.value='starred';share.value=null;const result=await api.listStarred();if(!isCurrent())return;files.value=result.files;clearSelection();pathStack.value=[{id:'starred',name:'收藏'}];cacheView('starred')})}
async function loadRecent(preferCache=false){if(preferCache&&restoreCachedView('recent','recent'))return;await runPage(async isCurrent=>{mode.value='recent';share.value=null;const result=await api.listRecent();if(!isCurrent())return;files.value=result.files;clearSelection();pathStack.value=[{id:'recent',name:'最近'}];cacheView('recent')})}
async function searchAll(){const value=globalQuery.value.trim();if(value.length<2)return;const generation=++searchGeneration;searchLive.value={scanned:0,folders:0,matchesCount:0,isDone:false};await runPage(async isCurrent=>{mode.value='search';share.value=null;const result=await api.searchDrive(value);if(generation!==searchGeneration||!isCurrent())return;files.value=result.files||[];searchStats.value=result;query.value='';clearSelection();pathStack.value=[{id:'search',name:`搜索：${value}`}]})}
async function cancelSearch(){searchGeneration++;invalidatePageRequest();try{await api.cancelSearch();searchLive.value={...searchLive.value,isDone:true}}catch(e){error.value=e.message||String(e)}}
async function loadMyShares(preferCache=false){if(preferCache&&restoreCachedView('myshares','myshares'))return;await runPage(async isCurrent=>{mode.value='myshares';share.value=null;const result=await api.listMyShares();if(!isCurrent())return;files.value=result.files;clearSelection();pathStack.value=[{id:'myshares',name:'我的分享'}];cacheView('myshares')})}
async function loadShare(rawUrl,name='分享根目录',reset=false){await runPage(async isCurrent=>{mode.value='share';const result=await api.openShare(rawUrl);if(!isCurrent())return;share.value=result.share;files.value=result.files;clearSelection();const part={id:result.share.parentToken||'root',name,url:result.share.url};if(reset)pathStack.value=[part];else pathStack.value.push(part);if(!result.bridgeAvailable&&!files.value.some(item=>item.encodedToken))error.value='目录已加载，但页面桥接暂不可用，子目录可能无法进入'})}
async function openShare(){const raw=shareUrl.value.trim();if(!raw)return;await loadShare(raw,'分享根目录',true)}
async function hydrateFile(item){
  if(item.kind==='drive#folder'||!['drive','starred','recent','search','share'].includes(mode.value))return item;
  try{
    const detail=mode.value==='share'
      ? await api.getShareFile({shareId:share.value.shareId,fileId:item.id})
      : await api.getDriveFile(item.id);
    const merged={...item,...(detail.file||detail)};if(selected.value?.id===item.id)selected.value=merged;return merged;
  }catch(e){error.value=e.message||String(e);return item}
}
async function openItem(item){if(item.kind==='pikpak#share'){selected.value=item;selectedIds.value=[item.id];await copyMyShare();return}if(item.kind==='drive#folder'){if(mode.value==='search'){pathStack.value=[{id:'',name:'全部文件'},{id:item.id,name:item.name}];await loadDrive(item.id,item.name,'replace')}else if(['drive','starred','recent'].includes(mode.value)){await loadDrive(item.id,item.name)}else if(item.encodedToken){const url=new URL(share.value.url);const parts=url.pathname.split('/').filter(Boolean),index=parts.indexOf('s');url.pathname='/'+parts.slice(0,index+2).concat(item.encodedToken).join('/');await loadShare(url.href,item.name,false)}else{error.value='该目录没有可用的进入 token，请刷新后重试'}return}selected.value=item;selectedIds.value=[item.id];await openSelected()}
async function selectItem(item,event){
  if(boxSuppressClick){return}
  const list=visibleFiles.value,idx=list.findIndex(entry=>entry.id===item.id);
  if(event?.shiftKey&&lastClickedIndex.value>=0&&lastClickedIndex.value<list.length&&idx>=0){
    const range=[lastClickedIndex.value,idx].sort((a,b)=>a-b);
    const rangeIds=list.slice(range[0],range[1]+1).map(entry=>entry.id);
    if(event.ctrlKey||event.metaKey){const merged=new Set([...selectedIds.value,...rangeIds]);selectedIds.value=[...merged]}
    else{selectedIds.value=rangeIds}
  }else if(event?.ctrlKey||event?.metaKey){
    selectedIds.value=selectedIds.value.includes(item.id)?selectedIds.value.filter(id=>id!==item.id):[...selectedIds.value,item.id];
    if(idx>=0)lastClickedIndex.value=idx;
  }else{
    selectedIds.value=[item.id];
    if(idx>=0)lastClickedIndex.value=idx;
  }
  selected.value=item;
  if(selected.value?.id===item.id)await hydrateFile(item);
}
async function toggleSelect(item,event){
  if(event){event.stopPropagation();event.preventDefault()}
  const idx=visibleFiles.value.findIndex(entry=>entry.id===item.id);
  selectedIds.value=selectedIds.value.includes(item.id)?selectedIds.value.filter(id=>id!==item.id):[...selectedIds.value,item.id];
  if(idx>=0)lastClickedIndex.value=idx;
  if(selectedIds.value.includes(item.id))selected.value=item;
  if(selected.value?.id===item.id)await hydrateFile(item);
}
function onFilePanelMouseDown(e){
  if(e.button!==0)return;
  const t=e.target;
  if(t&&typeof t.closest==='function'&&t.closest('button,a,input,textarea,select,.context-menu,.batch-toolbar'))return;
  boxBaseIds=[...selectedIds.value];
  boxAdditive=Boolean(e.ctrlKey||e.metaKey);
  boxSuppressClick=false;
  boxSelect.value={active:false,startX:e.clientX,startY:e.clientY,curX:e.clientX,curY:e.clientY};
}
function onBoxMouseMove(e){
  const bs=boxSelect.value;
  if(!bs.startX)return;
  bs.curX=e.clientX;bs.curY=e.clientY;
  const dx=bs.curX-bs.startX,dy=bs.curY-bs.startY;
  if(!bs.active&&Math.hypot(dx,dy)<4)return;
  if(!bs.active)bs.active=true;
  applyBoxSelection();
}
function onBoxMouseUp(){
  const bs=boxSelect.value;
  if(bs.active){
    boxSuppressClick=true;
    bs.active=false;
    setTimeout(()=>{boxSuppressClick=false},0);
  }
  boxSelect.value={active:false,startX:0,startY:0,curX:0,curY:0};
}
function applyBoxSelection(){
  const panel=filePanelEl.value;
  const bs=boxSelect.value;
  if(!panel||!bs.active)return;
  const x0=Math.min(bs.startX,bs.curX),x1=Math.max(bs.startX,bs.curX);
  const y0=Math.min(bs.startY,bs.curY),y1=Math.max(bs.startY,bs.curY);
  const ids=[];
  panel.querySelectorAll('.file-row').forEach(row=>{
    const r=row.getBoundingClientRect();
    if(r.left<x1&&r.right>x0&&r.top<y1&&r.bottom>y0){
      const id=row.getAttribute('data-id');
      if(id)ids.push(id);
    }
  });
  if(boxAdditive){
    selectedIds.value=[...new Set([...boxBaseIds,...ids])];
  }else{
    selectedIds.value=ids;
  }
  if(ids.length&&!selectedIds.value.includes(selected.value?.id)){
    selected.value=visibleFiles.value.find(item=>item.id===ids[0])||selected.value;
  }
}
const boxSelectStyle=computed(()=>{
  const bs=boxSelect.value;
  if(!bs.active)return {};
  const rect=filePanelEl.value?.getBoundingClientRect();
  if(!rect)return {};
  const x0=Math.min(bs.startX,bs.curX)-rect.left;
  const y0=Math.min(bs.startY,bs.curY)-rect.top;
  return {left:x0+'px',top:y0+'px',width:Math.abs(bs.curX-bs.startX)+'px',height:Math.abs(bs.curY-bs.startY)+'px',display:'block'};
});
async function downloadSelected(){
  if(!selectedItems.value.length)return;
  let started=0;
  for(const rawRoot of selectedItems.value){
    if(rawRoot.kind==='drive#folder'){
      const queue=[{id:rawRoot.id,relDir:rawRoot.name,encodedToken:rawRoot.encodedToken||''}];
      while(queue.length){
        const current=queue.shift();
        try{
          let children=[];
          if(mode.value==='share'&&share.value?.url){
            const url=new URL(share.value.url);
            const parts=url.pathname.split('/').filter(Boolean),index=parts.indexOf('s');
            if(current.encodedToken){
              url.pathname='/'+parts.slice(0,index+2).concat(current.encodedToken).join('/');
            }
            const res=await api.openShare(url.href);
            children=res.files||[];
          }else{
            const res=await api.listDrive(current.id);
            children=res.files||[];
          }
          for(const child of children){
            if(child.kind==='drive#folder'){
              queue.push({id:child.id,relDir:`${current.relDir}/${child.name}`,encodedToken:child.encodedToken||''});
            }else{
              const item=await hydrateFile(child);
              const url=contentUrl(item);
              if(url){
                const refreshId=mode.value==='share'&&share.value?.shareId?`share:${share.value.shareId}:${item.id}`:`drive:${item.id}`;
                const task=await api.startDownload({url,name:item.name,subDir:current.relDir,refreshId});
                upsertDownload(task);
                started++;
              }
            }
          }
        }catch(e){
          error.value=`读取目录“${current.relDir}”失败: `+(e.message||String(e));
        }
      }
    }else{
      const item=await hydrateFile(rawRoot);
      const url=contentUrl(item);
      if(url){
        const refreshId=mode.value==='share'&&share.value?.shareId?`share:${share.value.shareId}:${item.id}`:`drive:${item.id}`;
        const task=await api.startDownload({url,name:item.name,subDir:'',refreshId});
        upsertDownload(task);
        started++;
      }
    }
  }
  if(!started){
    if(!error.value)error.value='选中项中没有可用下载内容或为空文件夹';
  }else{
    mode.value='transfers';
  }
}
async function loadArchivePath(pathValue='',nodes=[]){const state=archive.value;if(!state.request)return;state.loading=true;state.error='';state.items=[];try{let result=await api.listArchive({...state.request,path:pathValue,password:state.password});if(result.passwordRequired){const password=await promptAction({title:'输入压缩包密码',message:result.message||'此压缩包需要密码',placeholder:'压缩包密码',type:'password',confirmLabel:'解锁'});if(password===null){if(!state.items.length)state.open=false;return}state.password=password;result=await api.listArchive({...state.request,path:pathValue,password});if(result.passwordRequired)throw new Error('压缩包密码不正确')}state.items=result.items||[];state.path=pathValue;state.nodes=nodes}catch(e){state.error=e.message||String(e)}finally{state.loading=false}}
async function openArchive(item){archive.value={open:true,name:item.name,items:[],path:'',nodes:[{name:'全部',path:''}],password:'',loading:false,error:'',request:{scope:mode.value==='share'?'share':'drive',fileId:item.id,shareId:share.value?.shareId||'',passCodeToken:share.value?.passCodeToken||''}};await loadArchivePath('',archive.value.nodes)}
async function enterArchiveFolder(item){const name=item.name||'目录',pathValue=item.path||`${archive.value.path}${name}/`;await loadArchivePath(pathValue,[...archive.value.nodes,{name,path:pathValue}])}
async function navigateArchiveCrumb(index){const nodes=archive.value.nodes.slice(0,index+1);await loadArchivePath(nodes.at(-1)?.path||'',nodes)}
function imageViewerItems(current){
  return visibleFiles.value.filter(isImage).slice(0,5000).map(entry=>{
    const value=entry.id===current.id?current:entry;
    return {id:String(value.id||''),name:value.name||'图片',url:previewUrl(value)};
  }).filter(entry=>/^https?:\/\//i.test(entry.url));
}
function videoViewerPlaylist(current){
  const all=visibleFiles.value.filter(item=>item.kind!=='drive#folder'&&isVideo(item));
  const index=all.findIndex(entry=>entry.id===current.id);
  if(index<0)return [];
  const start=Math.max(0,Math.min(index-50,Math.max(0,all.length-101)));
  return all.slice(start,start+101).map(entry=>{
    const value=entry.id===current.id?current:entry;
    return {
      fileId:mode.value==='share'?`share:${share.value?.shareId||''}:${value.id}`:`drive:${value.id}`,
      name:String(value.name||'视频'),
      url:entry.id===current.id?previewUrl(value):'',
      sources:entry.id===current.id?playbackSources(value):[]
    };
  });
}
function matchSubtitles(videoName,fileList){const subExtensions=new Set(['srt','vtt','ass']);const subFiles=(fileList||[]).filter(item=>{if(!item||item.kind==='drive#folder')return false;const ext=String(item.name||'').split('.').pop()?.toLowerCase();return subExtensions.has(ext)});if(!subFiles.length)return [];const baseName=String(videoName||'').replace(/\.[^/.]+$/,'').trim().toLowerCase();const scored=subFiles.map(file=>{const subBase=String(file.name).replace(/\.[^/.]+$/,'').trim().toLowerCase();let score=0;if(subBase===baseName)score=100;else if(subBase.startsWith(baseName))score=80;else if(baseName.startsWith(subBase))score=70;else{const videoTokens=new Set(baseName.split(/[._\-\s]+/).filter(t=>t.length>1)),subTokens=subBase.split(/[._\-\s]+/).filter(t=>t.length>1),overlap=subTokens.filter(t=>videoTokens.has(t)).length;if(overlap>0)score=Math.min(60,overlap*20);else score=10}return {file,score}});return scored.filter(item=>item.score>0).sort((a,b)=>b.score-a.score).map(item=>item.file)}
async function matchedSubtitlesFor(item){if(!isVideo(item))return [];const subs=matchSubtitles(item.name,files.value).slice(0,5),result=[];for(const sub of subs){let hydrated=sub;if(!contentUrl(hydrated)){try{hydrated=await hydrateFile(sub)}catch{}}const url=contentUrl(hydrated);if(url)result.push({id:sub.id,name:sub.name,url})}return result}
async function openSelected(){if(!selectedItems.value.length)return;if(selectedItems.value.length>1){error.value=`预览仅支持单个文件，请先仅勾选一项（当前已选 ${selectedItems.value.length} 项）`;return}const item=await hydrateFile(selectedItems.value[0]);if(!canPreview(item)){error.value='此文件类型暂不支持预览，请明确点击下载按钮后在本机打开';return}if(isArchive(item)){await openArchive(item);return}const url=previewUrl(item);if(!url){error.value='当前文件没有可用的查看地址';return}try{const progressId=mode.value==='share'?`share:${share.value?.shareId||''}:${item.id}`:`drive:${item.id}`;const video=isVideo(item),subtitles=video?await matchedSubtitlesFor(item):[];await api.openViewer({url,name:item.name,fileId:progressId,mimeType:item.mime_type||'',sources:video?playbackSources(item):[],items:isImage(item)?imageViewerItems(item):[],subtitles,playlist:video?videoViewerPlaylist(item):[]})}catch(e){error.value=e.message||String(e)}}
async function showProperties(item){propertiesDialog.value={open:true,loading:item.kind!=='drive#folder',item};if(item.kind==='drive#folder')return;try{propertiesDialog.value.item=await hydrateFile(item)}finally{propertiesDialog.value.loading=false}}
function showContextMenu(item,event){if(!selectedIds.value.includes(item.id)){selectedIds.value=[item.id];selected.value=item}const width=190,height=310;contextMenu.value={open:true,x:Math.max(8,Math.min(event.clientX,window.innerWidth-width-8)),y:Math.max(8,Math.min(event.clientY,window.innerHeight-height-8)),item}}
function closeContextMenu(){contextMenu.value.open=false}
async function contextAction(action){const item=contextMenu.value.item;closeContextMenu();if(item)await itemAction(item,action)}
function mediaDetails(item){const media=(item?.medias||[]).find(value=>value?.media_info)||item?.medias?.[0]||{},info=media.media_info||item?.media_info||{};return {duration:Number(info.duration||item?.duration||0),width:Number(info.width||media?.video?.width||0),height:Number(info.height||media?.video?.height||0)}}
async function itemAction(item,action){if(!(selectedIds.value.includes(item.id)&&selectedIds.value.length>1)){selectedIds.value=[item.id]}selected.value=item;const actions={open:openSelected,properties:()=>showProperties(item),download:downloadSelected,save:saveShareSelected,share:createShareSelected,star:toggleStarred,copy:()=>stageTransfer('copy'),move:()=>stageTransfer('move'),rename:renameSelected,trash:trashSelected,restore:restoreSelected,delete:deleteForever,copyShare:copyMyShare,cancelShare:cancelMyShares};await actions[action]?.()}
async function loadSaveDialogFolders(parentId){shareSaveDialog.value.loading=true;try{const res=await api.listDrive(parentId);shareSaveDialog.value.folders=(res.files||[]).filter(item=>item.kind==='drive#folder')}catch(e){error.value=e.message||String(e)}finally{shareSaveDialog.value.loading=false}}
async function navigateSaveDialog(folder){shareSaveDialog.value.targetId=folder.id;shareSaveDialog.value.targetName=folder.name;shareSaveDialog.value.path.push(folder);await loadSaveDialogFolders(folder.id)}
async function navigateSaveDialogCrumb(index){shareSaveDialog.value.path=shareSaveDialog.value.path.slice(0,index+1);const current=shareSaveDialog.value.path.at(-1);shareSaveDialog.value.targetId=current?.id||'';shareSaveDialog.value.targetName=current?.name||'根目录';await loadSaveDialogFolders(shareSaveDialog.value.targetId)}
async function saveShareSelected(){if(!selectedItems.value.length||mode.value!=='share'||!share.value)return;if(!account.value.connected){error.value='请先连接 PikPak 账户，再保存分享文件';return}shareSaveDialog.value={open:true,purpose:'share',pendingUrl:'',targetId:'',targetName:'根目录',folders:[],loading:true,path:[{id:'',name:'根目录'}]};await loadSaveDialogFolders('')}
async function confirmSaveTarget(toParentId=''){
  shareSaveDialog.value.open=false;
  if(shareSaveDialog.value.purpose==='offline'){
    const url=shareSaveDialog.value.pendingUrl;
    await run(async()=>{await api.createOfflineTask({url,parentId:toParentId||''});offlineUrl.value='';notice.value=toParentId?`离线下载任务已创建，将保存到「${shareSaveDialog.value.targetName}」`:'离线下载任务已创建，将保存到默认下载目录';await refreshOfflineTasks();setTimeout(()=>{notice.value=''},4000)});
    return;
  }
  const items=selectedItems.value.slice();
  await run(async()=>{
    await api.restoreShare({shareId:share.value.shareId,passCodeToken:share.value.passCodeToken||'',fileIds:items.map(item=>item.id),toParentId:toParentId||undefined});
    const targetLabel=toParentId?`到「${shareSaveDialog.value.targetName}」`:'到我的网盘根目录';
    if(items.length>2){
      showBatchResult({title:'分享保存完成',operation:'saveShare',details:items.map(i=>({name:i.name,status:'success',message:`已保存${targetLabel}`}))});
    }else{
      notice.value=`已提交保存 ${items.length} 项${targetLabel}`;
      setTimeout(()=>{notice.value=''},4000);
    }
  });
}
async function createShareSelected(){const items=selectedItems.value.slice();if(!items.length)return;shareCreateDialog.value={open:true,expirationDays:7,encrypted:true,items}}
async function confirmCreateShare(){const state=shareCreateDialog.value,items=state.items.slice();if(!items.length)return;state.open=false;await run(async()=>{const result=await api.createShare({ids:items.map(item=>item.id),expirationDays:Number(state.expirationDays),encrypted:state.encrypted});notice.value=`已创建${state.encrypted?'加密':'公开'}分享并复制链接${result.passCode?`，提取码 ${result.passCode}`:''}`;setTimeout(()=>{notice.value=''},6000)})}
async function copyMyShare(){if(!selectedItems.value.length)return;if(selectedItems.value.length>1){error.value=`复制链接仅支持单个分享，请先仅勾选一项（当前已选 ${selectedItems.value.length} 项）`;return}const item=selectedItems.value[0];await api.copyShare({shareUrl:item.share_url,passCode:item.pass_code});notice.value=`“${item.name}”的链接已复制`;setTimeout(()=>{notice.value=''},3500)}
async function cancelMyShares(){if(!selectedItems.value.length)return;const ok=await confirmAction({title:'取消分享',message:`取消选中的 ${selectedItems.value.length} 个分享？原网盘文件不会被删除。`,confirmLabel:'取消分享',danger:true});if(!ok)return;await run(async()=>{await api.cancelShares(selectedItems.value.map(item=>item.id));notice.value='分享已取消';await loadMyShares();setTimeout(()=>{notice.value=''},3500)})}
function offlineName(task){return task.name||task.file_name||task.reference_resource?.name||task.source_url||'离线任务'}
function offlinePhase(task){if(task._state?.label)return task._state.label;const phase=String(task.phase||'').toUpperCase();if(phase.includes('COMPLETE'))return '已完成';if(phase.includes('ERROR')||phase.includes('FAILED'))return '失败';if(phase.includes('PAUSED'))return '已暂停';if(phase.includes('RUNNING'))return '下载中';return '等待中'}
function offlinePercent(task){if(task._state&&Number.isFinite(task._state.percent))return task._state.percent;const value=Number(task.progress||task.progress_percent||0);return Math.max(0,Math.min(100,Math.round(value<=1?value*100:value)))}
async function refreshOfflineTasks(){
  if(offlineRefreshPromise)return offlineRefreshPromise;
  offlineRefreshPromise=api.listOfflineTasks().then(result=>{offlineTasks.value=result.tasks||[];return offlineTasks.value}).finally(()=>{offlineRefreshPromise=null});
  return offlineRefreshPromise;
}
function showSearchPage(){invalidatePageRequest();searchGeneration++;mode.value='search';files.value=[];searchStats.value=null;pathStack.value=[{id:'search',name:'全盘搜索'}];clearSelection()}
function showExternalSearch(){invalidatePageRequest();mode.value='external-search';error.value='';clearSelection()}
async function searchExternal(){const value=externalQuery.value.trim();if(value.length<2)return;await run(async()=>{const result=await api.searchExternal(value);externalResults.value=result.results||[]})}
async function copyExternal(result){await api.copyExternalMagnet(result.magnet);notice.value=`已复制“${result.title}”的磁力链接`;setTimeout(()=>{notice.value=''},3000)}
async function addExternal(result){await run(async()=>{await api.addExternalMagnet(result.magnet);notice.value=`已添加“${result.title}”到离线下载`;setTimeout(()=>{notice.value=''},3500)})}
function externalMagnetSummary(value){return String(value||'').split('&')[0]}
function showSettings(){invalidatePageRequest();mode.value='settings';clearSelection()}
function showShareStart(){invalidatePageRequest();mode.value='share';share.value=null;files.value=[];clearSelection()}
async function loadTransfers(){invalidatePageRequest();mode.value='transfers';clearSelection();if(account.value.connected)await run(refreshOfflineTasks)}
async function createOffline(){const value=offlineUrl.value.trim();if(!value)return;if(!account.value.connected){error.value='请先连接 PikPak 账户';return}shareSaveDialog.value={open:true,purpose:'offline',pendingUrl:value,targetId:'',targetName:'根目录',folders:[],loading:true,path:[{id:'',name:'根目录'}]};await loadSaveDialogFolders('')}
async function deleteOffline(id){const ok=await confirmAction({title:'删除离线任务',message:'删除这条离线任务记录？已保存的文件不会被删除。',confirmLabel:'删除记录',danger:true});if(!ok)return;await run(async()=>{await api.deleteOfflineTask(id);await refreshOfflineTasks()})}
function itemIsStarred(item){return !!(item?.starred||(item?.tags||[]).some(tag=>tag?.name==='STAR'))}
async function toggleStarred(){if(!selectedItems.value.length)return;const value=selectedItems.value.some(item=>!itemIsStarred(item));await run(async()=>{await api.setStarred({ids:selectedItems.value.map(item=>item.id),starred:value});notice.value=value?`已收藏 ${selectedItems.value.length} 项`:`已取消收藏 ${selectedItems.value.length} 项`;if(mode.value==='starred')await loadStarred();else{files.value=files.value.map(item=>selectedIds.value.includes(item.id)?{...item,starred:value}:item);if(selected.value)selected.value={...selected.value,starred:value}}setTimeout(()=>{notice.value=''},3000)})}
function upsertDownload(task){const index=downloads.value.findIndex(item=>item.id===task.id);if(index<0)downloads.value.unshift(task);else downloads.value[index]={...downloads.value[index],...task}}
function upsertUpload(task){const index=uploads.value.findIndex(item=>item.id===task.id);if(index<0)uploads.value.unshift(task);else uploads.value[index]={...uploads.value[index],...task};if(task.state==='completed'&&mode.value==='drive')setTimeout(()=>resumeDrive(),700)}
async function chooseUpload(){const parentId=mode.value==='drive'?(pathStack.value.at(-1)?.id||''):'';const tasks=await api.chooseUpload({parentId});for(const task of tasks)upsertUpload(task)}
async function chooseUploadFolder(){const tasks=await api.chooseUploadFolder({parentId:pathStack.value.at(-1)?.id||''});for(const task of tasks)upsertUpload(task);await resumeDrive()}
async function dropFiles(event){dragUpload.value=false;if(mode.value!=='drive'||!account.value.connected)return;const files=event.dataTransfer?.files;if(!files?.length)return;try{const tasks=await api.uploadDroppedFiles(files,{parentId:pathStack.value.at(-1)?.id||''});for(const task of tasks)upsertUpload(task)}catch(e){error.value=e.message||String(e)}}
function leaveDrop(event){if(!event.currentTarget.contains(event.relatedTarget))dragUpload.value=false}
function uploadState(task){return task.state==='completed'?'已完成':task.state==='failed'?'失败':task.state==='cancelled'?'已取消':task.state==='interrupted'?'已中断':task.state==='hashing'?'正在校验':task.state==='queued'?'等待中':'正在上传'}
async function clearFinishedUploads(){uploads.value=await api.clearUploads()}
async function removeUpload(id){uploads.value=await api.removeUpload(id)}
async function retryUploadTask(id){try{const task=await api.retryUpload(id);upsertUpload(task)}catch(e){error.value=e.message||String(e)}}
async function retryDownloadTask(id){try{const task=await api.retryDownload(id);upsertDownload(task)}catch(e){error.value=e.message||String(e)}}
async function chooseDownloadDirectory(){const value=await api.chooseDownloadDirectory();if(value)settings.value.downloadDirectory=value}
async function chooseExternalPlayer(){const value=await api.chooseExternalPlayer();if(value)settings.value.externalPlayerPath=value}
async function persistSettings(){try{settings.value=await api.saveSettings(settings.value);notice.value='设置已保存';setTimeout(()=>{notice.value=''},2500)}catch(e){error.value=e.message||String(e)}}
async function resetSettingsToDefault(){const ok=await confirmAction({title:'恢复默认设置',message:'确定将所有设置恢复为默认值吗？',confirmLabel:'恢复默认',danger:true});if(!ok)return;try{settings.value=await api.resetSettings();notice.value='已恢复默认设置';setTimeout(()=>{notice.value=''},2500)}catch(e){error.value=e.message||String(e)}}
async function clearAllDataCache(){const ok=await confirmAction({title:'清理缓存与记录',message:'确定要清理本机的下载历史、上传历史、播放进度和会话缓存吗？云端网盘文件不会受到影响。',confirmLabel:'清理缓存',danger:true});if(!ok)return;try{await api.clearAppCache();downloads.value=[];uploads.value=[];notice.value='已清理本机缓存与传输历史记录';setTimeout(()=>{notice.value=''},3000)}catch(e){error.value=e.message||String(e)}}
async function exportDiagnosticsReport(){try{const report=await api.exportDiagnostics();const text=JSON.stringify(report,null,2);const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`pikpak-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`;a.click();URL.revokeObjectURL(url);const crashes=(report?.crashReports||[]).length;notice.value=crashes?`诊断报告已导出（含 ${crashes} 条崩溃报告）`:'诊断报告已导出';setTimeout(()=>{notice.value=''},3200)}catch(e){error.value=e.message||String(e)}}
function setSort(key){if(sortBy.value===key)sortDirection.value*=-1;else{sortBy.value=key;sortDirection.value=1}}
async function clearDownloadHistory(){downloads.value=await api.clearDownloads()}
async function removeDownload(id){downloads.value=await api.removeDownload(id)}
async function refreshQuota(){if(!account.value.connected){quota.value=null;return}try{quota.value=(await api.getAccountAbout()).quota}catch{quota.value=null}}
async function saveToken(){account.value=await api.setAccessToken(token.value.trim());token.value='';if(account.value.connected){restoreNavigationState();refreshQuota();resumeDrive()}}
async function webLogin(){error.value='';await run(async()=>{account.value=await api.login();authState.value=account.value.authState||authState.value;if(account.value.connected){restoreNavigationState();await Promise.all([refreshQuota(),resumeDrive()])}})}
async function logout(){await run(async()=>{account.value=await api.logout();quota.value=null;files.value=[];viewCache.clear();resetNavigationState();try{localStorage.removeItem(NAV_STATE_KEY)}catch{}})}
async function createFolder(){const name=await promptAction({title:'新建文件夹',message:'输入新文件夹名称',placeholder:'文件夹名称',confirmLabel:'创建'});if(!name?.trim())return;await run(async()=>{await api.createFolder({parentId:pathStack.value.at(-1)?.id||'',name:name.trim()});await loadDrive(pathStack.value.at(-1)?.id||'',pathStack.value.at(-1)?.name,'replace')})}
async function renameSelected(){if(!selectedItems.value.length)return;if(selectedItems.value.length>1){error.value=`重命名仅支持单个文件，当前已选 ${selectedItems.value.length} 项，请先仅勾选一项`;return}const item=selectedItems.value[0];const name=await promptAction({title:'重命名',message:'输入新的文件或文件夹名称',value:item.name,confirmLabel:'保存'});if(!name?.trim()||name.trim()===item.name)return;await run(async()=>{await api.rename({id:item.id,name:name.trim()});await loadDrive(pathStack.value.at(-1)?.id||'',pathStack.value.at(-1)?.name,'replace')})}
function stageTransfer(operation){if(!selectedItems.value.length)return;clipboard.value={operation,items:selectedItems.value.map(({id,name,kind})=>({id,name,kind})),sourceParentId:pathStack.value.at(-1)?.id||''}}
function showBatchResult({title,operation,details}){
  const successCount=details.filter(d=>d.status==='success').length;
  const skipCount=details.filter(d=>d.status==='skipped').length;
  const failCount=details.filter(d=>d.status==='failed').length;
  batchResultModal.value={open:true,title:title||'批量操作完成',operation:operation||'',successCount,skipCount,failCount,details};
}
function detectConflicts(sources,targets){
  const targetMap=new Map();
  for(const t of targets||[]){if(t?.name)targetMap.set(String(t.name).trim().toLowerCase(),t)}
  const conflicts=[],nonConflicts=[];
  for(const s of sources||[]){
    const key=String(s?.name||'').trim().toLowerCase();
    if(key&&targetMap.has(key))conflicts.push({source:s,existing:targetMap.get(key)});
    else if(s)nonConflicts.push(s);
  }
  return {conflicts,nonConflicts};
}
function generateUniqueName(name,existingNames){
  const existingSet=new Set((existingNames||[]).map(n=>String(n).trim().toLowerCase()));
  const trimmed=String(name||'未命名').trim();
  if(!existingSet.has(trimmed.toLowerCase()))return trimmed;
  const dotIdx=trimmed.lastIndexOf('.'),hasExt=dotIdx>0&&dotIdx<trimmed.length-1;
  const base=hasExt?trimmed.slice(0,dotIdx):trimmed,ext=hasExt?trimmed.slice(dotIdx):'';
  let candidate=`${base} - 副本${ext}`,count=2;
  while(existingSet.has(candidate.toLowerCase())){candidate=`${base} - 副本 (${count})${ext}`;count++}
  return candidate;
}
async function executeTransfer(operation,items,targetId,extraDetails=[]){
  await run(async()=>{
    try{
      if(items.length)await api.transfer({operation,ids:items.map(item=>item.id),parentId:targetId});
      if(operation==='move')clipboard.value=null;
      await loadDrive(targetId,pathStack.value.at(-1)?.name,'replace');
      const details=[...items.map(i=>({name:i.name,status:'success',message:operation==='move'?'已剪切并移动':'已复制'})),...extraDetails];
      if(extraDetails.length>0||details.length>2){
        showBatchResult({title:operation==='move'?'批量移动完成':'批量复制完成',operation,details});
      }else{
        notice.value=`${operation==='move'?'已移动':'已复制'} ${items.length} 项`;
        setTimeout(()=>{notice.value=''},3500);
      }
    }catch(e){error.value=e.message||String(e)}
  });
}
async function pasteTransfer(){
  if(!clipboard.value||mode.value!=='drive')return;
  const targetId=pathStack.value.at(-1)?.id||'';
  if(clipboard.value.sourceParentId===targetId){error.value='源目录与目标目录相同';return}
  const {conflicts,nonConflicts}=detectConflicts(clipboard.value.items,files.value);
  if(conflicts.length>0){
    conflictDialog.value={open:true,operation:clipboard.value.operation,conflicts,nonConflicts,targetId,targetName:pathStack.value.at(-1)?.name||'当前目录',loading:false};
  }else{
    await executeTransfer(clipboard.value.operation,clipboard.value.items,targetId);
  }
}
async function resolveConflicts(strategy){
  const {operation,conflicts,nonConflicts,targetId}=conflictDialog.value;
  conflictDialog.value.loading=true;
  try{
    if(strategy==='skip'){
      conflictDialog.value.open=false;
      const skippedDetails=conflicts.map(c=>({name:c.source.name,status:'skipped',message:'目标目录存在同名项，已跳过'}));
      await executeTransfer(operation,nonConflicts,targetId,skippedDetails);
    }else if(strategy==='overwrite'){
      conflictDialog.value.open=false;
      await api.trash(conflicts.map(c=>c.existing.id));
      const allItems=[...nonConflicts,...conflicts.map(c=>c.source)];
      const overwriteDetails=conflicts.map(c=>({name:c.source.name,status:'success',message:'已覆盖原有同名项'}));
      await executeTransfer(operation,allItems,targetId,overwriteDetails);
    }else if(strategy==='rename'){
      conflictDialog.value.open=false;
      const existingNames=files.value.map(f=>f.name),renamedDetails=[],transferredSuccess=[...nonConflicts];
      for(const c of conflicts){
        const unique=generateUniqueName(c.source.name,existingNames);
        existingNames.push(unique);
        if(operation==='move'){
          await api.rename({id:c.source.id,name:unique});
          transferredSuccess.push({...c.source,name:unique});
          renamedDetails.push({name:`${c.source.name} → ${unique}`,status:'success',message:'已重命名并移动'});
        }else{
          await api.rename({id:c.source.id,name:unique});
          await api.transfer({operation:'copy',ids:[c.source.id],parentId:targetId});
          await api.rename({id:c.source.id,name:c.source.name});
          renamedDetails.push({name:`${c.source.name} (副本: ${unique})`,status:'success',message:'已重命名并复制'});
        }
      }
      if(operation==='move')clipboard.value=null;
      await loadDrive(targetId,pathStack.value.at(-1)?.name,'replace');
      const details=[...nonConflicts.map(i=>({name:i.name,status:'success',message:operation==='move'?'已剪切并移动':'已复制'})),...renamedDetails];
      showBatchResult({title:operation==='move'?'批量移动完成':'批量复制完成',operation,details});
    }
  }catch(e){error.value=e.message||String(e)}finally{conflictDialog.value.loading=false}
}
async function trashSelected(){
  if(!selectedItems.value.length)return;
  const ok=await confirmAction({title:'移入回收站',message:`确定将选中的 ${selectedItems.value.length} 项移入回收站吗？`,confirmLabel:'移入回收站',danger:true});if(!ok)return;
  const count=selectedItems.value.length,items=selectedItems.value.slice();
  await run(async()=>{
    await api.trash(items.map(item=>item.id));
    await loadDrive(pathStack.value.at(-1)?.id||'',pathStack.value.at(-1)?.name,'replace');
    if(count>2){
      showBatchResult({title:'批量移入回收站完成',operation:'trash',details:items.map(i=>({name:i.name,status:'success',message:'已移入回收站'}))});
    }else{
      notice.value=`已将 ${count} 项移入回收站`;
      setTimeout(()=>{notice.value=''},3000);
    }
  });
}
async function restoreSelected(){
  if(!selectedItems.value.length)return;
  const count=selectedItems.value.length,items=selectedItems.value.slice();
  await run(async()=>{
    await api.restoreTrash(items.map(item=>item.id));
    await loadTrash();
    if(count>2){
      showBatchResult({title:'批量恢复完成',operation:'restore',details:items.map(i=>({name:i.name,status:'success',message:'已恢复至网盘'}))});
    }else{
      notice.value=`已恢复 ${count} 项`;
      setTimeout(()=>{notice.value=''},3000);
    }
  });
}
async function deleteForever(){
  if(!selectedItems.value.length)return;
  const ok=await confirmAction({title:'永久删除',message:`永久删除选中的 ${selectedItems.value.length} 项？此操作无法撤销。`,confirmLabel:'永久删除',danger:true});if(!ok)return;
  const count=selectedItems.value.length,items=selectedItems.value.slice();
  await run(async()=>{
    await api.deleteTrash(items.map(item=>item.id));
    await loadTrash();
    if(count>2){
      showBatchResult({title:'批量永久删除完成',operation:'delete',details:items.map(i=>({name:i.name,status:'success',message:'已永久删除'}))});
    }else{
      notice.value=`已永久删除 ${count} 项`;
      setTimeout(()=>{notice.value=''},3000);
    }
  });
}
function navigateCrumb(index){const target=pathStack.value[index];pathStack.value=pathStack.value.slice(0,index+1);if(mode.value==='drive'){if(isSentinelId(target.id)){loadSentinelPage(target.id);return}loadDrive(target.id,target.name,'replace')}else if(target.url)loadShare(target.url,target.name,false)}
let trackpadBackDistance=0,trackpadBackTimer=null,trackpadBackLocked=false,trackpadNavigating=false;
const TRACKPAD_GESTURE_GAP_MS=90;
function handleTrackpadNavigation(event){
  if(appInfo.value.platform!=='darwin'||hasActiveModal()||Math.abs(event.deltaX)<=Math.abs(event.deltaY))return;
  event.preventDefault();
  clearTimeout(trackpadBackTimer);trackpadBackTimer=setTimeout(()=>{trackpadBackDistance=0;trackpadBackLocked=false},TRACKPAD_GESTURE_GAP_MS);
  if(pathStack.value.length<2){trackpadBackDistance=0;trackpadBackLocked=true;return}
  if(trackpadBackLocked||trackpadNavigating)return;
  trackpadBackDistance+=event.deltaX;
  if(trackpadBackDistance<-90){trackpadBackDistance=0;trackpadBackLocked=true;trackpadNavigating=true;Promise.resolve(navigateCrumb(pathStack.value.length-2)).finally(()=>{trackpadNavigating=false})}
}
function refreshCurrent(){
  if(mode.value==='drive'){loadDrive(pathStack.value.at(-1)?.id,'','replace');return}
  if(mode.value==='share'&&share.value){pathStack.value.pop();loadShare(share.value.url,pathStack.value.at(-1)?.name||'分享目录',false);return}
  if(mode.value==='starred'){loadStarred();return}
  if(mode.value==='recent'){loadRecent();return}
  if(mode.value==='myshares'){loadMyShares();return}
  if(mode.value==='trash'){loadTrash();return}
  if(mode.value==='transfers'&&account.value.connected)refreshOfflineTasks().catch(e=>{error.value=e.message||String(e)})
}
function handleMenuCommand(command){
  if(command==='refresh'){refreshCurrent();return}
  if(command==='transfers'){loadTransfers();return}
  if(command==='settings'){showSettings();return}
  if(command==='open-share')showShareStart()
}
function hasActiveModal(){
  return Boolean(archive.value?.open || shareSaveDialog.value?.open || shareCreateDialog.value?.open || conflictDialog.value?.open || batchResultModal.value?.open || confirmDialog.value?.open || inputDialog.value?.open);
}
function confirmAction({title='确认操作',message='',confirmLabel='确定',danger=false}={}){
  return new Promise(resolve=>{confirmDialog.value={open:true,title,message,confirmLabel,danger,resolve};});
}
function resolveConfirm(value){
  const resolve=confirmDialog.value?.resolve;
  confirmDialog.value={open:false,title:'',message:'',confirmLabel:'确定',danger:false,resolve:null};
  if(resolve)resolve(!!value);
}
function promptAction({title='输入内容',message='',value='',placeholder='',type='text',confirmLabel='确定'}={}){
  return new Promise(resolve=>{inputDialog.value={open:true,title,message,value,placeholder,type:type==='password'?'password':'text',confirmLabel,resolve}});
}
function resolvePrompt(accepted){
  const state=inputDialog.value,resolve=state?.resolve;
  const value=accepted?String(state.value||''):null;
  inputDialog.value={open:false,title:'',message:'',value:'',placeholder:'',type:'text',confirmLabel:'确定',resolve:null};
  if(resolve)resolve(value);
}
function closeActiveModal(){
  if(contextMenu.value?.open){contextMenu.value.open=false;return true}
  if(inputDialog.value?.open){resolvePrompt(false);return true}
  if(confirmDialog.value?.open){resolveConfirm(false);return true}
  if(propertiesDialog.value?.open){propertiesDialog.value.open=false;return true}
  if(batchResultModal.value?.open){batchResultModal.value.open=false;return true}
  if(conflictDialog.value?.open){conflictDialog.value.open=false;return true}
  if(shareCreateDialog.value?.open){shareCreateDialog.value.open=false;return true}
  if(shareSaveDialog.value?.open){shareSaveDialog.value.open=false;return true}
  if(archive.value?.open){archive.value.open=false;return true}
  return false;
}
function handleGlobalKeyDown(e){
  const tag=e.target?.tagName;
  const isInput=tag==='INPUT'||tag==='TEXTAREA'||Boolean(e.target?.isContentEditable);
  if(e.key==='Escape'){
    if(closeActiveModal()){e.preventDefault();return}
    if(!isInput&&selectedIds.value.length){e.preventDefault();clearSelection();return}
  }
  if(isInput||hasActiveModal())return;
  const key=e.key, isCtrlOrCmd=e.ctrlKey||e.metaKey;
  if(isCtrlOrCmd&&(key==='a'||key==='A')&&!e.shiftKey&&!e.altKey){
    if(['drive','starred','recent','trash','search','share'].includes(mode.value)&&visibleFiles.value.length){
      e.preventDefault();
      selectedIds.value=visibleFiles.value.map(f=>f.id);
      if(!selected.value||!selectedIds.value.includes(selected.value.id))selected.value=visibleFiles.value[0];
    }
    return;
  }
  if(key==='F5'||(isCtrlOrCmd&&(key==='r'||key==='R')&&!e.shiftKey&&!e.altKey)){
    e.preventDefault();
    refreshCurrent();
    return;
  }
  if(key==='F2'){
    if(mode.value==='drive'&&selected.value){e.preventDefault();renameSelected()}
    return;
  }
  if(key==='Delete'){
    if(selectedIds.value.length){
      e.preventDefault();
      if(['drive','starred','recent','search'].includes(mode.value))trashSelected();
      else if(mode.value==='trash')deleteForever();
    }
    return;
  }
  if(isCtrlOrCmd&&(key==='c'||key==='C')&&!e.shiftKey&&!e.altKey){
    if(mode.value==='drive'&&selectedItems.value.length){e.preventDefault();stageTransfer('copy')}
    return;
  }
  if(isCtrlOrCmd&&(key==='x'||key==='X')&&!e.shiftKey&&!e.altKey){
    if(mode.value==='drive'&&selectedItems.value.length){e.preventDefault();stageTransfer('move')}
    return;
  }
  if(isCtrlOrCmd&&(key==='v'||key==='V')&&!e.shiftKey&&!e.altKey){
    if(mode.value==='drive'&&clipboard.value){e.preventDefault();pasteTransfer()}
    return;
  }
  if(key===' '||key==='Spacebar'){
    if(selected.value){e.preventDefault();openItem(selected.value)}
    return;
  }
  if(key==='Enter'){
    if(selected.value&&!e.target?.classList?.contains('file-row')){e.preventDefault();openItem(selected.value)}
    return;
  }
  if(key==='ArrowDown'||key==='ArrowUp'){
    if(['drive','starred','recent','trash','search','share'].includes(mode.value)&&visibleFiles.value.length){
      e.preventDefault();
      const list=visibleFiles.value;
      if(!selected.value||!selectedIds.value.length){
        selected.value=list[0];
        selectedIds.value=[list[0].id];
        return;
      }
      const currentIndex=list.findIndex(f=>f.id===selected.value.id);
      let nextIndex=0;
      if(currentIndex===-1)nextIndex=0;
      else if(key==='ArrowDown')nextIndex=Math.min(list.length-1,currentIndex+1);
      else nextIndex=Math.max(0,currentIndex-1);
      if(nextIndex>=renderedLimit.value-5){
        renderedLimit.value=Math.min(list.length,renderedLimit.value+60);
      }
      selected.value=list[nextIndex];
      selectedIds.value=[list[nextIndex].id];
      nextTick(()=>{
        const selectedEl=document.querySelector('.file-row.selected');
        if(selectedEl&&typeof selectedEl.scrollIntoView==='function')selectedEl.scrollIntoView({block:'nearest'});
      });
    }
  }
}
watch([mode,pathStack],persistNavigationState,{deep:true});
onMounted(async()=>{
  removeMenuCommandListener=api.onMenuCommand?.(handleMenuCommand)||(()=>{});
  api.onDownload(upsertDownload);
  api.onUpload(upsertUpload);
  api.onOfflineClipboard(value=>{if(value?.ok){refreshOfflineTasks().catch(()=>{});notice.value='已从剪贴板检测到磁力链接，自动开始离线下载'}else notice.value=value?.message||'剪贴板磁力链接创建离线任务失败';setTimeout(()=>{notice.value=''},5000)});
  api.onSearchProgress(val=>{
    if(val)searchLive.value={...val};
    if(val?.matchesCount&&!searchStats.value)searchStats.value={scanned:val.scanned,folders:val.folders};
  });
  api.onAccountExpired(()=>{account.value={connected:false};quota.value=null;files.value=[];viewCache.clear();resetNavigationState();try{localStorage.removeItem(NAV_STATE_KEY)}catch{}});
  api.onAuthState(value=>{if(value)authState.value=value});
  [downloads.value,uploads.value,settings.value,appInfo.value]=await Promise.all([api.listDownloads(),api.listUploads(),api.getSettings(),api.getAppInfo()]);
  account.value=await api.getAccount();
  authState.value=account.value.authState||authState.value;
  if(account.value.connected){restoreNavigationState();refreshQuota();resumeDrive()}else{resetNavigationState()}
  offlinePollTimer=setInterval(()=>{if(mode.value==='transfers'&&account.value.connected&&!document.hidden)refreshOfflineTasks().catch(()=>{})},10000);
  window.addEventListener('keydown',handleGlobalKeyDown);
  window.addEventListener('wheel',handleTrackpadNavigation,{passive:false});
  window.addEventListener('click',closeContextMenu);
  window.addEventListener('blur',closeContextMenu);
  window.addEventListener('mousemove',onBoxMouseMove);
  window.addEventListener('mouseup',onBoxMouseUp);
});
onUnmounted(()=>{
  removeMenuCommandListener();
  if(offlinePollTimer)clearInterval(offlinePollTimer);
  clearTimeout(trackpadBackTimer);
  window.removeEventListener('keydown',handleGlobalKeyDown);
  window.removeEventListener('wheel',handleTrackpadNavigation);
  window.removeEventListener('click',closeContextMenu);
  window.removeEventListener('blur',closeContextMenu);
  window.removeEventListener('mousemove',onBoxMouseMove);
  window.removeEventListener('mouseup',onBoxMouseUp);
  themeMedia?.removeEventListener?.('change',handleSystemThemeChange);
});
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="logo">P</span><div><b>PikPak</b><small>Desktop</small></div></div>
      <nav>
        <button :class="{active:mode==='drive'}" @click="loadDrive('','全部文件','reset',true)"><span>☁</span> 我的文件</button>
        <button :class="{active:mode==='search'}" @click="showSearchPage"><span>⌕</span> 全盘搜索</button>
        <button :class="{active:mode==='external-search'}" @click="showExternalSearch"><span>◎</span> 外部搜索</button>
        <button :class="{active:mode==='starred'}" @click="loadStarred(true)"><span>★</span> 收藏</button>
        <button :class="{active:mode==='recent'}" @click="loadRecent(true)"><span>◷</span> 最近</button>
        <button :class="{active:mode==='myshares'}" @click="loadMyShares(true)"><span>♢</span> 我的分享</button>
        <button :class="{active:mode==='share'}" @click="showShareStart"><span>🔗</span> 分享链接</button>
        <button :class="{active:mode==='transfers'}" @click="loadTransfers"><span>⇅</span> 传输中心 <small v-if="uploads.length+downloads.length+offlineTasks.length">{{uploads.length+downloads.length+offlineTasks.length}}</small></button>
        <button :class="{active:mode==='trash'}" @click="loadTrash(true)"><span>♲</span> 回收站</button>
        <button :class="{active:mode==='settings'}" @click="showSettings"><span>⚙</span> 设置</button>
      </nav>
      <button v-if="account.connected" class="quota-card" title="点击刷新容量" @click="refreshQuota"><template v-if="quota"><span><b>存储空间</b><small>{{size(quota.used)}} / {{size(quota.limit)}}</small></span><em>{{quota.percent.toFixed(1)}}%</em><i><u :style="{width:quota.percent+'%'}"></u></i></template><span v-else><b>存储空间</b><small>点击刷新</small></span></button>
      <button class="account-card" @click="account.connected?logout():webLogin()"><span :class="['dot',{online:account.connected}]"></span>{{account.connected?'账户已连接 · 退出':'网页登录 PikPak'}}</button>
    </aside>

    <main class="main">
      <header class="toolbar">
        <div class="toolbar-top">
          <div class="toolbar-heading"><h1 :title="title">{{title}}</h1></div>
          <div class="toolbar-actions">
              <input v-if="['drive','starred','recent','myshares','trash'].includes(mode)||(mode==='share'&&share)" v-model="query" class="search" aria-label="搜索当前目录" placeholder="搜索当前目录">
              <button v-if="mode==='drive'&&clipboard" class="paste" @click="pasteTransfer">粘贴 {{clipboard.items.length}} 项</button>
              <button v-if="mode==='drive'&&account.connected" class="primary" @click="chooseUpload">↑ 上传文件</button>
              <button v-if="mode==='drive'&&account.connected" class="soft" @click="chooseUploadFolder">↑ 上传文件夹</button>
              <button v-if="mode==='drive'&&account.connected" class="soft" @click="createFolder">＋ 新建文件夹</button>
              <button v-if="!['transfers','trash','starred','recent','myshares'].includes(mode)" class="soft" @click="refreshCurrent">↻ 刷新</button>
              <button v-if="mode==='starred'" class="soft" @click="loadStarred">↻ 刷新</button>
              <button v-if="mode==='recent'" class="soft" @click="loadRecent">↻ 刷新</button>
              <button v-if="mode==='myshares'" class="soft" @click="loadMyShares">↻ 刷新</button>
              <button v-if="mode==='trash'" class="soft" @click="loadTrash">↻ 刷新</button>
              <button v-if="mode==='transfers'&&account.connected" class="soft" @click="refreshOfflineTasks">↻ 刷新</button>
              <button v-if="mode==='transfers'&&uploads.some(task=>['completed','failed','cancelled'].includes(task.state))" class="soft" @click="clearFinishedUploads">清理上传记录</button>
              <button v-if="mode==='transfers'&&downloads.length" class="soft" @click="clearDownloadHistory">清理下载记录</button>
              <button class="primary" @click="showShareStart">＋ 打开分享</button>
          </div>
        </div>
        <div class="toolbar-sub">
          <div class="crumbs"><template v-for="(part,i) in pathStack" :key="part.id"><button class="crumb-btn" :title="part.name" @click="navigateCrumb(i)">{{part.name}}</button><span v-if="i<pathStack.length-1" class="crumb-sep">›</span></template></div>
        </div>
      </header>
      <div v-if="notice" class="notice" role="status" aria-live="polite">✓ {{notice}}</div>
      <div v-if="mode!=='transfers'&&uploads.some(task=>!['completed','failed','cancelled'].includes(task.state))" class="upload-float"><article v-for="task in uploads.filter(row=>!['completed','failed','cancelled'].includes(row.state))" :key="task.id"><span><b>{{task.name}}</b><small>{{task.state==='hashing'?'正在校验文件':task.state==='queued'?'等待上传':'正在上传'}} · {{task.percent||0}}%</small></span><div class="progress"><i :style="{width:(task.percent||0)+'%'}"></i></div><button @click="api.cancelUpload(task.id)">取消</button></article></div>

      <section v-if="mode==='external-search'" class="external-search-panel"><div class="external-search-head"><h2>外部搜索</h2><form @submit.prevent="searchExternal"><input v-model="externalQuery" autofocus aria-label="外部资源搜索关键词" placeholder="输入资源名称"><button class="primary" :disabled="loading">{{loading?'搜索中…':'搜索'}}</button></form><p v-if="error" class="error" role="alert">{{error}}</p><small>结果由 u9a9.org 提供；可复制磁力链接或直接添加到 PikPak。</small></div><div class="external-results"><div v-if="!loading&&!externalResults.length" class="state">输入关键词开始搜索</div><article v-for="result in externalResults" :key="result.key" class="external-result"><div><b :title="result.title">{{result.title}}</b><small :title="externalMagnetSummary(result.magnet)">{{externalMagnetSummary(result.magnet)}}</small></div><button class="soft" @click="copyExternal(result)">复制磁力</button><button class="primary" :disabled="!account.connected" @click="addExternal(result)">保存到网盘</button></article></div></section>
      <section v-else-if="mode==='search'&&!searchStats" class="connect-panel search-all-panel"><div class="hero-icon">⌕</div><h2>搜索整个 PikPak</h2><p :class="{error}" :role="error?'alert':'status'" aria-live="polite">{{error|| (loading?`正在遍历目录，已扫描 ${searchLive.folders} 个目录、${searchLive.scanned} 项，找到 ${searchLive.matchesCount} 项…`:'后台遍历网盘目录，并在结果中保留文件所在路径。')}}</p><form @submit.prevent="searchAll"><input v-model="globalQuery" autofocus aria-label="全盘搜索关键词" placeholder="至少输入 2 个字符"><button class="primary" :disabled="loading">{{loading?'搜索中…':'开始搜索'}}</button><button v-if="loading" type="button" class="soft" @click="cancelSearch">取消搜索</button></form></section>
      <section v-else-if="mode==='transfers'" class="transfer-center">
        <div class="transfer-section downloads-panel"><h2>⇧ 上传任务 <small>{{uploads.length}}</small></h2>
          <div v-if="!uploads.length" class="transfer-empty">暂无上传任务</div>
          <article v-for="task in uploads" :key="task.id" class="download-row"><div class="download-icon">⇧</div><div class="download-info"><b>{{task.name}}</b><div class="progress"><i :style="{width:(task.percent||0)+'%'}"></i></div><small :class="{error:task.state==='failed'}">{{uploadState(task)}} · {{task.percent||0}}%<template v-if="task.error"> · {{task.error}}</template></small></div><div class="download-actions"><button v-if="['failed','cancelled','interrupted'].includes(task.state)" class="soft" @click="retryUploadTask(task.id)">重试</button><button v-if="!['completed','failed','cancelled','interrupted'].includes(task.state)" class="soft" @click="api.cancelUpload(task.id)">取消</button><button v-else class="remove" title="移除记录" @click="removeUpload(task.id)">×</button></div></article>
        </div>
        <div class="transfer-section downloads-panel"><h2>⇩ 本机下载 <small>{{downloads.length}}</small></h2>
          <div v-if="!downloads.length" class="transfer-empty">暂无本机下载任务</div>
          <article v-for="task in downloads" :key="task.id" class="download-row"><div class="download-icon">⇩</div><div class="download-info"><b>{{task.name}}<small v-if="task.subDir" class="download-subdir"> ({{task.subDir}})</small></b><div class="progress"><i :style="{width:(task.percent||0)+'%'}"></i></div><small :class="{error:task.state==='failed'}">{{task.state==='completed'?'下载完成':task.state==='cancelled'?'已取消':task.state==='interrupted'?'下载中断':task.state==='failed'?'下载失败':`${task.percent||0}% · ${size(task.received)} / ${size(task.total)}`}}<template v-if="task.error"> · {{task.error}}</template></small></div><div class="download-actions"><button v-if="task.state==='completed'" class="soft" @click="api.showDownload(task.id)">定位</button><button v-if="['failed','cancelled','interrupted'].includes(task.state)" class="soft" @click="retryDownloadTask(task.id)">重试</button><button v-else-if="!['cancelled','interrupted','failed'].includes(task.state)" class="soft" @click="api.cancelDownload(task.id)">取消</button><button v-if="!['queued','progress'].includes(task.state)" class="remove" title="移除记录" @click="removeDownload(task.id)">×</button></div></article>
        </div>
        <div class="transfer-section offline-panel"><h2>⚡ 离线下载 <small>{{offlineTasks.length}}</small></h2>
          <form class="offline-form" @submit.prevent="createOffline"><input v-model="offlineUrl" aria-label="离线下载地址" placeholder="粘贴磁力链、HTTP/HTTPS 或 ED2K 地址"><button class="primary">创建任务</button></form>
          <div v-if="loading&&!offlineTasks.length" class="transfer-empty">正在加载…</div><div v-else-if="error" class="transfer-empty error">{{error}}</div><div v-else-if="!offlineTasks.length" class="transfer-empty">暂无离线下载任务</div>
          <article v-for="task in offlineTasks" :key="task.id||task.task_id" class="offline-row"><div class="download-icon">⚡</div><div class="download-info"><b>{{offlineName(task)}}</b><div class="progress"><i :style="{width:offlinePercent(task)+'%'}"></i></div><small>{{offlinePhase(task)}} · {{offlinePercent(task)}}%</small></div><button class="remove" title="删除任务" @click="deleteOffline(task.id||task.task_id)">×</button></article>
        </div>
      </section>
      <section v-else-if="mode==='settings'" class="settings-panel">
        <h2>界面外观</h2><p>可跟随 macOS/Windows 系统外观，也可固定使用浅色或深色主题。</p>
        <label><span><b>颜色主题</b><small>切换后立即预览，点击页面底部“保存设置”后长期生效。</small></span><select v-model="settings.theme" aria-label="颜色主题"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <h2>传输设置</h2><p>设置会保存在当前系统用户中，重启客户端后继续生效。</p>
        <label><span><b>默认下载目录</b><small>{{settings.downloadDirectory||settings.effectiveDownloadDirectory||'系统下载目录'}}</small></span><button class="soft" @click="chooseDownloadDirectory">选择目录</button></label>
        <label><span><b>外部播放器</b><small>{{settings.externalPlayerPath||`未设置（可选择 ${appInfo.platform==='darwin'?'VLC、IINA 或 mpv':'PotPlayer、VLC 或 MPC'}）`}}</small></span><button class="soft" @click="chooseExternalPlayer">选择程序</button></label>
        <label><span><b>同时下载任务数</b><small>范围 1–8</small></span><input v-model.number="settings.downloadConcurrency" type="number" min="1" max="8"></label>
        <label><span><b>同时上传任务数</b><small>范围 1–8</small></span><input v-model.number="settings.uploadConcurrency" type="number" min="1" max="8"></label>
        <label><span><b>剪贴板磁力链自动离线下载</b><small>复制磁力链接后自动创建离线下载任务（保存到默认下载目录）。</small></span><input v-model="settings.clipboardMagnet" type="checkbox" aria-label="剪贴板磁力链自动离线下载"></label>
        <h2>快捷键指南</h2><p>客户端支持完整的桌面快捷键与键盘无障碍操作：</p>
        <div class="shortcut-table">
          <div class="shortcut-row"><kbd>Ctrl + A</kbd><span>全选当前列表文件</span></div>
          <div class="shortcut-row"><kbd>Delete</kbd><span>移入回收站 / 永久删除</span></div>
          <div class="shortcut-row"><kbd>F2</kbd><span>重命名当前选中项</span></div>
          <div class="shortcut-row"><kbd>F5 / Ctrl + R</kbd><span>刷新当前目录或分享</span></div>
          <div class="shortcut-row"><kbd>Ctrl + C / X / V</kbd><span>复制 / 剪切 / 粘贴文件</span></div>
          <div class="shortcut-row"><kbd>Space (空格)</kbd><span>快速打开预览音视频/图片</span></div>
          <div class="shortcut-row"><kbd>Enter (回车)</kbd><span>进入文件夹或打开查看器</span></div>
          <div class="shortcut-row"><kbd>↑ / ↓</kbd><span>在文件列表中上下移动高亮项</span></div>
          <div class="shortcut-row"><kbd>Esc</kbd><span>取消选中或关闭当前对话框</span></div>
        </div>
        <h2>隐私与数据安全说明</h2>
        <div class="privacy-card">
          <div class="privacy-item">
            <b>🔐 本地凭证安全加密</b>
            <p>登录授权 Token 仅保存在本地用户数据目录，默认采用操作系统级凭证层（Windows SafeStorage / DPAPI）加密存储，不上传非 PikPak 官方的任何第三方服务器。</p>
          </div>
          <div class="privacy-item">
            <b>⚡ 端到端直连传输</b>
            <p>文件上传、分片及下载请求直接在您的电脑与官方存储节点（Aliyun OSS / PikPak CDN）之间建立 HTTPS 加密连接，无中间服务器代理中转。</p>
          </div>
          <div class="privacy-item">
            <b>🛡️ 零追踪与敏感日志脱敏</b>
            <p>本客户端无任何用户隐私遥测、埋点追踪或广告 SDK；本地运行日志与诊断信息对 Token、密码等私密数据实施强制脱敏抹除。</p>
          </div>
        </div>
        <h2>系统诊断</h2><p>用于排查问题，诊断信息已自动脱敏，不含账户 Token 或敏感密码。</p>
        <div class="privacy-card"><div class="privacy-item"><b>PikPak Desktop {{appInfo.version}}</b><p>{{appInfo.packaged?'正式构建':'开发模式'}}<template v-if="appInfo.buildTime"> · 构建于 {{new Date(appInfo.buildTime).toLocaleString()}}</template></p><p v-if="appInfo.logsDirectory">日志目录：{{appInfo.logsDirectory}}</p></div></div>
        <div class="settings-actions"><button class="soft" @click="exportDiagnosticsReport">导出诊断报告 (JSON)</button><button class="warn" @click="resetSettingsToDefault">恢复默认设置</button></div>
        <h2>数据与缓存管理</h2><p>一键清理本机存储的下载/上传历史、播放进度与网络会话缓存。清理不会删除云端网盘文件。</p>
        <div class="settings-actions"><button class="warn" @click="clearAllDataCache">一键清理缓存与记录</button></div>
        <h2>第三方开源许可</h2><p>PikPak Desktop 构建于以下优秀的开源基础组件之上：</p>
        <div class="license-list">
          <div class="license-row"><b>Electron</b><span>v44.2.0</span><span>MIT License</span></div>
          <div class="license-row"><b>Vue</b><span>v3.5</span><span>MIT License</span></div>
          <div class="license-row"><b>Vite</b><span>v8</span><span>MIT License</span></div>
          <div class="license-row"><b>hls.js</b><span>v1.7.2</span><span>Apache License 2.0</span></div>
          <div class="license-row"><b>Vitest</b><span>v5.0.0</span><span>MIT License</span></div>
          <div class="license-row"><b>electron-builder</b><span>v26</span><span>MIT License</span></div>
        </div>
        <footer><button class="primary" @click="persistSettings">保存设置</button></footer>
      </section>
      <section v-else-if="mode==='share'&&!share" class="connect-panel">
        <div class="hero-icon">🔗</div><h2>打开 PikPak 分享</h2><p>粘贴公开分享链接，在桌面客户端中浏览和预览文件。</p>
        <form @submit.prevent="openShare"><input v-model="shareUrl" aria-label="PikPak 分享链接" placeholder="https://mypikpak.com/s/…"><button class="primary">打开分享</button></form>
      </section>
      <section v-else-if="mode==='drive'&&!account.connected" class="connect-panel">
        <div class="hero-icon">🔐</div><h2>连接 PikPak 账户</h2><p>在官方 PikPak 窗口完成登录，客户端会安全接收授权并加密保存。</p>
        <p v-if="authState.message" :class="{error:authState.state==='retryable-error'}" :role="authState.state==='retryable-error'?'alert':'status'" aria-live="polite">{{authState.message}}</p>
        <button class="primary login-main" :disabled="loading" @click="webLogin">{{loading?'等待登录完成…':authState.state==='retryable-error'?'重新打开 PikPak 登录':'打开 PikPak 登录'}}</button>
        <details><summary>高级：使用 Access Token</summary><form @submit.prevent="saveToken"><input v-model="token" type="password" aria-label="Access Token" placeholder="Access Token"><button class="soft">连接</button></form></details>
      </section>
      <section v-else class="content">
        <div ref="filePanelEl" :class="['file-panel',{'drop-active':dragUpload}]" role="region" :aria-label="`${title}文件列表`" @mousedown="onFilePanelMouseDown" @dragstart.prevent @scroll.passive="onListScroll" @dragenter.prevent="mode==='drive'&&account.connected&&(dragUpload=true)" @dragover.prevent @dragleave="leaveDrop" @drop.prevent="dropFiles">
          <div v-if="mode==='search'&&searchStats" class="search-summary"><form @submit.prevent="searchAll"><input v-model="globalQuery" aria-label="新的全盘搜索关键词" placeholder="输入新的搜索关键词"><button class="primary" :disabled="loading">{{loading?'搜索中…':'重新搜索'}}</button><button v-if="loading" type="button" class="soft" @click="cancelSearch">取消搜索</button></form><small aria-live="polite">已扫描 {{searchLive.folders||searchStats.folders}} 个目录、{{searchLive.scanned||searchStats.scanned}} 项，找到 {{files.length}} 项<span v-if="searchStats.truncated">（结果已达到安全上限）</span></small></div>
          <div class="list-head"><button :aria-label="`按名称${sortBy==='name'?(sortDirection>0?'降序':'升序'):'排序'}`" @click="setSort('name')">名称 {{sortBy==='name'?(sortDirection>0?'↑':'↓'):''}}</button><button :aria-label="`按大小${sortBy==='size'?(sortDirection>0?'降序':'升序'):'排序'}`" @click="setSort('size')">大小 {{sortBy==='size'?(sortDirection>0?'↑':'↓'):''}}</button><button :aria-label="`按修改时间${sortBy==='time'?(sortDirection>0?'降序':'升序'):'排序'}`" @click="setSort('time')">修改时间 {{sortBy==='time'?(sortDirection>0?'↑':'↓'):''}}</button></div>
          <div v-if="loading" class="state" role="status" aria-live="polite">正在加载…</div><div v-else-if="error" class="state error" role="alert">{{error}}</div><div v-else-if="!files.length" class="state" role="status">这个目录是空的</div>
          <div v-for="item in displayFiles" :key="item.id" :data-id="item.id" :class="['file-row',{selected:selectedIds.includes(item.id),anchor:selected?.id===item.id}]" role="button" tabindex="0" :aria-label="`${item.name}，${item.kind==='drive#folder'?'文件夹':size(item.size)}`" :aria-pressed="selectedIds.includes(item.id)?'true':'false'" :title="item.kind==='drive#folder'?'双击进入文件夹':canPreview(item)?'双击打开':'此类型暂不支持预览，请右键或选中后使用下方操作条处理'" @click="selectItem(item,$event)" @contextmenu.prevent.stop="showContextMenu(item,$event)" @dblclick="openItem(item)" @keydown.enter="openItem(item)">
            <span class="file-name"><button type="button" class="row-check" role="checkbox" :aria-checked="selectedIds.includes(item.id)?'true':'false'" :aria-label="`${selectedIds.includes(item.id)?'取消选择':'选择'} ${item.name}`" :title="selectedIds.includes(item.id)?'取消选择':'选中'" @click.stop="toggleSelect(item,$event)" @dblclick.stop>{{selectedIds.includes(item.id)?'✓':''}}</button><span class="file-visual" aria-hidden="true"><img v-if="item.thumbnail_link&&!thumbFailed[item.id]&&item.kind!=='drive#folder'" :src="item.thumbnail_link" alt="" loading="lazy" @error="markThumbFailed(item)"><i v-else>{{icon(item)}}</i></span><span><b><template v-for="(part,index) in highlightedParts(item.name)" :key="index"><mark v-if="part.match">{{part.text}}</mark><template v-else>{{part.text}}</template></template></b><small><template v-for="(part,index) in highlightedParts(item._search_path||item.mime_type||item.kind)" :key="index"><mark v-if="part.match">{{part.text}}</mark><template v-else>{{part.text}}</template></template></small></span></span><span>{{size(item.size)}}</span><span>{{item.modified_time?new Date(item.modified_time).toLocaleString():'—'}}</span>
          </div>
          <div v-if="visibleFiles.length>displayFiles.length" class="list-load-more">
            <span>已加载 {{displayFiles.length}} / {{visibleFiles.length}} 项</span>
            <button class="soft" @click="renderedLimit=visibleFiles.length">加载全部 ({{visibleFiles.length}})</button>
          </div>
          <svg v-if="selectedItems.length>0" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
            <symbol id="bk-share" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></g></symbol>
            <symbol id="bk-star" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.4l-5.84 3.08 1.11-6.5-4.72-4.6 6.53-.95z"/></g></symbol>
            <symbol id="bk-download" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/></g></symbol>
            <symbol id="bk-move" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 9.5V17a2 2 0 0 0 2 2h7"/><path d="M13 15.5h8"/><path d="M17.5 12l3.5 3.5-3.5 3.5"/></g></symbol>
            <symbol id="bk-copy" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></g></symbol>
            <symbol id="bk-trash" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-.9 13a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></g></symbol>
            <symbol id="bk-close" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></g></symbol>
            <symbol id="bk-save" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11H4z"/><path d="M8 4v6h7"/><path d="M8 20v-4h8v4"/></g></symbol>
            <symbol id="bk-restore" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></g></symbol>
          </defs></svg>
          <div v-if="selectedItems.length>0" class="batch-toolbar" role="toolbar" :aria-label="`已选择 ${selectedItems.length} 项的批量操作`">
            <template v-if="['drive','starred','recent','search'].includes(mode)">
              <button title="分享" aria-label="分享所选项目" @click="createShareSelected"><svg class="batch-icon"><use href="#bk-share"/></svg></button>
              <button :title="selectedItems.some(item=>!itemIsStarred(item))?'收藏':'取消收藏'" :aria-label="selectedItems.some(item=>!itemIsStarred(item))?'收藏所选项目':'取消收藏所选项目'" @click="toggleStarred"><svg class="batch-icon"><use href="#bk-star"/></svg></button>
              <button title="下载" aria-label="下载所选项目" @click="downloadSelected"><svg class="batch-icon"><use href="#bk-download"/></svg></button>
              <i class="batch-sep"></i>
              <button title="移动到其他目录" aria-label="移动所选项目" @click="stageTransfer('move')"><svg class="batch-icon"><use href="#bk-move"/></svg></button>
              <button title="复制" aria-label="复制所选项目" @click="stageTransfer('copy')"><svg class="batch-icon"><use href="#bk-copy"/></svg></button>
              <i class="batch-sep"></i>
              <button title="移入回收站" aria-label="将所选项目移入回收站" @click="trashSelected"><svg class="batch-icon"><use href="#bk-trash"/></svg></button>
            </template>
            <template v-else-if="mode==='share'&&share">
              <button title="下载" aria-label="下载所选分享项目" @click="downloadSelected"><svg class="batch-icon"><use href="#bk-download"/></svg></button>
              <button title="保存到我的 PikPak" aria-label="保存所选项目到我的 PikPak" @click="saveShareSelected"><svg class="batch-icon"><use href="#bk-save"/></svg></button>
            </template>
            <template v-else-if="mode==='trash'">
              <button title="恢复" aria-label="恢复所选项目" @click="restoreSelected"><svg class="batch-icon"><use href="#bk-restore"/></svg></button>
              <i class="batch-sep"></i>
              <button title="永久删除" aria-label="永久删除所选项目" @click="deleteForever"><svg class="batch-icon"><use href="#bk-trash"/></svg></button>
            </template>
            <template v-else-if="mode==='myshares'">
              <button v-if="selectedItems.length===1" title="复制分享链接" aria-label="复制所选分享链接" @click="copyMyShare"><svg class="batch-icon"><use href="#bk-share"/></svg></button>
              <button title="取消分享" aria-label="取消所选分享" @click="cancelMyShares"><svg class="batch-icon"><use href="#bk-trash"/></svg></button>
            </template>
            <i class="batch-sep"></i>
            <button class="close" title="取消选择" aria-label="取消全部选择" @click="clearSelection"><svg class="batch-icon"><use href="#bk-close"/></svg></button>
          </div>
          <div v-if="boxSelect.active" class="box-select" :style="boxSelectStyle"></div>
        </div>
      </section>
    </main>
    <nav v-if="contextMenu.open" class="context-menu" :style="{left:contextMenu.x+'px',top:contextMenu.y+'px'}" @click.stop>
      <button v-if="contextMenu.item?.kind==='drive#folder'||canPreview(contextMenu.item)" @click="contextAction('open')">打开</button>
      <button @click="contextAction('properties')">属性</button>
      <button v-if="!['trash','myshares'].includes(mode)" @click="contextAction('download')">下载</button>
      <template v-if="['drive','starred','recent','search'].includes(mode)"><button @click="contextAction('star')">{{itemIsStarred(contextMenu.item)?'取消收藏':'收藏'}}</button><button @click="contextAction('share')">分享</button></template>
      <button v-if="mode==='share'&&share" @click="contextAction('save')">保存到网盘</button>
      <template v-if="mode==='drive'"><hr><button @click="contextAction('copy')">复制</button><button @click="contextAction('move')">剪切</button><button @click="contextAction('rename')">重命名</button><button class="warn" @click="contextAction('trash')">移入回收站</button></template>
      <template v-if="mode==='trash'"><hr><button @click="contextAction('restore')">恢复</button><button class="warn" @click="contextAction('delete')">永久删除</button></template>
      <template v-if="mode==='myshares'"><hr><button @click="contextAction('copyShare')">复制链接</button><button class="warn" @click="contextAction('cancelShare')">取消分享</button></template>
    </nav>
    <div v-if="propertiesDialog.open" class="archive-overlay" @click.self="propertiesDialog.open=false">
      <section class="archive-dialog properties-dialog" role="dialog" aria-modal="true" aria-label="文件属性">
        <header><div><small>{{propertiesDialog.item?.kind==='drive#folder'?'文件夹属性':'文件属性'}}</small><h2>{{propertiesDialog.item?.name}}</h2></div><button class="remove" title="关闭" @click="propertiesDialog.open=false">×</button></header>
        <div v-if="propertiesDialog.loading" class="archive-state">正在读取详细信息…</div>
        <dl v-else class="properties-list"><div><dt>类型</dt><dd>{{propertiesDialog.item?.kind==='drive#folder'?'文件夹':propertiesDialog.item?.mime_type||'文件'}}</dd></div><div><dt>大小</dt><dd>{{propertiesDialog.item?.kind==='drive#folder'?'—':size(propertiesDialog.item?.size)}}</dd></div><div><dt>创建时间</dt><dd>{{propertiesDialog.item?.created_time?new Date(propertiesDialog.item.created_time).toLocaleString():'—'}}</dd></div><div><dt>修改时间</dt><dd>{{propertiesDialog.item?.modified_time?new Date(propertiesDialog.item.modified_time).toLocaleString():'—'}}</dd></div><div v-if="mediaDetails(propertiesDialog.item).duration"><dt>时长</dt><dd>{{Math.round(mediaDetails(propertiesDialog.item).duration)}} 秒</dd></div><div v-if="mediaDetails(propertiesDialog.item).width"><dt>分辨率</dt><dd>{{mediaDetails(propertiesDialog.item).width}} × {{mediaDetails(propertiesDialog.item).height}}</dd></div></dl>
        <footer><button class="primary" @click="propertiesDialog.open=false">完成</button></footer>
      </section>
    </div>
    <div v-if="confirmDialog.open" class="archive-overlay" @click.self="resolveConfirm(false)">
      <section class="archive-dialog confirm-dialog" role="dialog" aria-modal="true" aria-label="确认操作">
        <header><div><small>{{confirmDialog.danger?'危险操作':'确认操作'}}</small><h2>{{confirmDialog.title}}</h2></div><button class="remove" title="关闭" @click="resolveConfirm(false)">×</button></header>
        <div class="confirm-body"><p>{{confirmDialog.message}}</p></div>
        <footer><button class="soft" @click="resolveConfirm(false)">取消</button><button :class="confirmDialog.danger?'warn':'primary'" @click="resolveConfirm(true)">{{confirmDialog.confirmLabel}}</button></footer>
      </section>
    </div>
    <div v-if="inputDialog.open" class="archive-overlay input-overlay" @click.self="resolvePrompt(false)">
      <section class="archive-dialog input-dialog" role="dialog" aria-modal="true" :aria-label="inputDialog.title">
        <header><div><small>请输入</small><h2>{{inputDialog.title}}</h2></div><button class="remove" type="button" title="关闭" @click="resolvePrompt(false)">×</button></header>
        <form @submit.prevent="resolvePrompt(true)">
          <p v-if="inputDialog.message">{{inputDialog.message}}</p>
          <input v-model="inputDialog.value" :type="inputDialog.type" :placeholder="inputDialog.placeholder" :aria-label="inputDialog.title" autocomplete="off" autofocus @focus="$event.target.select()">
          <footer><button class="soft" type="button" @click="resolvePrompt(false)">取消</button><button class="primary" :disabled="!inputDialog.value.trim()">{{inputDialog.confirmLabel}}</button></footer>
        </form>
      </section>
    </div>
    <div v-if="archive.open" class="archive-overlay" @click.self="archive.open=false">
      <section class="archive-dialog" role="dialog" aria-modal="true" :aria-label="archive.name">
        <header><div><small>压缩包内容</small><h2>{{archive.name}}</h2></div><button class="remove" title="关闭" @click="archive.open=false">×</button></header>
        <nav class="archive-crumbs"><button v-for="(part,index) in archive.nodes" :key="part.path" @click="navigateArchiveCrumb(index)">{{part.name}}<span v-if="index<archive.nodes.length-1">›</span></button></nav>
        <div class="archive-head"><span>名称</span><span>大小</span></div>
        <div class="archive-list">
          <div v-if="archive.loading" class="archive-state">正在读取压缩包…</div><div v-else-if="archive.error" class="archive-state error">{{archive.error}}</div><div v-else-if="!archive.items.length" class="archive-state">此目录为空</div>
          <button v-for="item in archive.items" :key="`${item.index}:${item.path}:${item.name}`" class="archive-row" :disabled="item.kind!=='drive#folder'" :title="item.kind==='drive#folder'?'双击进入目录':'只读查看，不会下载'" @dblclick="item.kind==='drive#folder'&&enterArchiveFolder(item)"><span><i>{{item.kind==='drive#folder'?'📁':'📄'}}</i>{{item.name}}</span><em>{{item.kind==='drive#folder'?'—':size(item.size)}}</em></button>
        </div>
        <footer>只读查看 · 不会下载或解压文件</footer>
      </section>
    </div>
    <div v-if="shareSaveDialog.open" class="archive-overlay" @click.self="shareSaveDialog.open=false">
      <section class="archive-dialog" role="dialog" aria-modal="true" aria-label="选择保存位置">
        <header><div><small>{{shareSaveDialog.purpose==='offline'?'选择离线下载保存位置':'保存分享文件到我的 PikPak'}}</small><h2>保存到：{{shareSaveDialog.targetName}}</h2></div><button class="remove" title="关闭" @click="shareSaveDialog.open=false">×</button></header>
        <nav class="archive-crumbs"><button v-for="(part,index) in shareSaveDialog.path" :key="part.id" @click="navigateSaveDialogCrumb(index)">{{part.name}}<span v-if="index<shareSaveDialog.path.length-1">›</span></button></nav>
        <div class="archive-head"><span>网盘文件夹</span><span>操作</span></div>
        <div class="archive-list">
          <div v-if="shareSaveDialog.loading" class="archive-state">正在加载文件夹…</div>
          <div v-else-if="!shareSaveDialog.folders.length" class="archive-state">当前目录下暂无子文件夹，可直接点击下方按钮保存到此处</div>
          <button v-for="folder in shareSaveDialog.folders" :key="folder.id" class="archive-row" title="点击选择并进入" @click="navigateSaveDialog(folder)"><span><i>📁</i>{{folder.name}}</span><em>进入 ›</em></button>
        </div>
        <footer class="share-dialog-actions">
          <button class="soft" @click="confirmSaveTarget('')">{{shareSaveDialog.purpose==='offline'?'使用默认下载目录':'直接保存到根目录'}}</button>
          <button class="primary" @click="confirmSaveTarget(shareSaveDialog.targetId)">{{shareSaveDialog.purpose==='offline'?'下载到':'保存到当前目录'}} ({{shareSaveDialog.targetName}})</button>
        </footer>
      </section>
    </div>
    <div v-if="shareCreateDialog.open" class="archive-overlay" @click.self="shareCreateDialog.open=false">
      <section class="archive-dialog share-create-dialog" role="dialog" aria-modal="true" aria-label="创建分享">
        <header><div><small>创建 PikPak 分享</small><h2>分享 {{shareCreateDialog.items.length}} 项文件</h2></div><button class="remove" title="关闭" @click="shareCreateDialog.open=false">×</button></header>
        <div class="share-create-body">
          <label><span><b>有效期</b><small>到期后分享链接自动失效</small></span><select v-model.number="shareCreateDialog.expirationDays"><option :value="1">1 天</option><option :value="7">7 天</option><option :value="30">30 天</option><option :value="-1">永久有效</option></select></label>
          <label><span><b>访问方式</b><small>{{shareCreateDialog.encrypted?'访问者需要输入提取码':'任何获得链接的人均可访问'}}</small></span><select v-model="shareCreateDialog.encrypted"><option :value="true">需要提取码</option><option :value="false">公开链接</option></select></label>
        </div>
        <footer class="share-dialog-actions"><button class="soft" @click="shareCreateDialog.open=false">取消</button><button class="primary" @click="confirmCreateShare">创建并复制链接</button></footer>
      </section>
    </div>
    <div v-if="conflictDialog.open" class="archive-overlay" @click.self="conflictDialog.open=false">
      <section class="archive-dialog conflict-dialog" role="dialog" aria-modal="true" aria-label="目标重名冲突">
        <header>
          <div><small>复制 / 移动重名冲突</small><h2>发现 {{conflictDialog.conflicts.length}} 项同名冲突</h2></div>
          <button class="remove" title="关闭" @click="conflictDialog.open=false">×</button>
        </header>
        <div class="conflict-summary">
          目标目录「{{conflictDialog.targetName}}」已存在同名项目。请选择冲突处理方式：
        </div>
        <div class="archive-list conflict-list">
          <div v-for="c in conflictDialog.conflicts" :key="c.source.id" class="archive-row conflict-row">
            <span><i>⚠️</i><b>{{c.source.name}}</b></span>
            <em>已有同名项</em>
          </div>
        </div>
        <footer class="conflict-dialog-actions">
          <button class="soft" :disabled="conflictDialog.loading" @click="resolveConflicts('skip')">跳过冲突项</button>
          <button class="soft" :disabled="conflictDialog.loading" @click="resolveConflicts('rename')">保留两者 (自动重命名)</button>
          <button class="warn" :disabled="conflictDialog.loading" @click="resolveConflicts('overwrite')">覆盖目标同名项</button>
          <button class="ghost" :disabled="conflictDialog.loading" @click="conflictDialog.open=false">取消</button>
        </footer>
      </section>
    </div>
    <div v-if="batchResultModal.open" class="archive-overlay" @click.self="batchResultModal.open=false">
      <section class="archive-dialog batch-result-dialog" role="dialog" aria-modal="true" :aria-label="batchResultModal.title">
        <header>
          <div><small>批量操作明细</small><h2>{{batchResultModal.title}}</h2></div>
          <button class="remove" title="关闭" @click="batchResultModal.open=false">×</button>
        </header>
        <div class="batch-result-stats">
          <span class="stat-badge stat-success">✓ 成功 {{batchResultModal.successCount}} 项</span>
          <span v-if="batchResultModal.skipCount" class="stat-badge stat-skip">⚠ 跳过 {{batchResultModal.skipCount}} 项</span>
          <span v-if="batchResultModal.failCount" class="stat-badge stat-fail">✕ 失败 {{batchResultModal.failCount}} 项</span>
        </div>
        <div class="archive-list batch-result-list">
          <div v-for="(item, idx) in batchResultModal.details" :key="idx" class="archive-row batch-result-row">
            <span>
              <i :class="['result-status-icon', item.status]">{{item.status === 'success' ? '✓' : item.status === 'skipped' ? '⚠' : '✕'}}</i>
              <b>{{item.name}}</b>
            </span>
            <em :class="['result-msg', item.status]">{{item.message}}</em>
          </div>
        </div>
        <footer class="batch-result-actions">
          <button class="primary" @click="batchResultModal.open=false">确定</button>
        </footer>
      </section>
    </div>
  </div>
</template>
